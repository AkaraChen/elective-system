# 后端验证修复方案

---

## P0 - 立即修复（数据一致性 / 安全性）

### #1 事务回调使用了全局 db 而非事务实例 tx

**影响范围：** `src/routes/courses.ts:71-99`、`src/routes/courses.ts:128-145`、`src/routes/admin-class.ts:91-107`

**修复方案：** 将所有 `db.transaction()` 回调内部 `db.xxx()` 替换为 `tx.xxx()`。

`src/routes/courses.ts` 选课接口：
```ts
db.transaction((tx) => {
  const course = tx.select().from(courses).where(eq(courses.id, courseId)).get();
  // ... 所有查询/更新都用 tx 而非 db
  const endTimeRow = tx.select({ value: config.value }).from(config).where(eq(config.key, "end_time")).get();
  tx.update(courses).set({ availableSeats: course.availableSeats - 1 }).where(eq(courses.id, courseId)).run();
  tx.insert(selections).values({ userId, courseId, createdAt: now }).run();
});
```

退课接口同理，`admin-class.ts` 批量导入同理。

---

### #2 零 CSRF 防护

**影响范围：** 所有 POST / PUT / DELETE 路由

**修复方案：**

1. 安装 csurf 或使用 `csurf-csrf`（csurf 已不再维护，推荐用 `csrf-csrf` 或自己用 cookie + token 实现）：
```bash
npm install csrf-csrf
```

2. 在 `src/index.ts` 中配置：
```ts
import { doubleCsrf } from "csrf-csrf";
const { generateToken, doubleCsrfProtection } = doubleCsrf({
  getSecret: () => req.session.csrfSecret || (req.session.csrfSecret = crypto.randomBytes(32).toString("hex")),
});
app.use(doubleCsrfProtection);
```

3. 在所有 EJS 的 `<form>` 中加入 hidden input：
```html
<input type="hidden" name="_csrf" value="<%= csrfToken %>" />
```

4. 设置 cookie SameSite 属性：`app.set("trust proxy", 1);` 并在 session 配置中加入 `cookie: { sameSite: "lax" }`。

5. 对所有 HTMX 非 GET 请求，在 `layout.ejs` 的 body 标签用 `hx-headers` 自动携带 csrf token。

---

### #3 Session 固定 + 硬编码密钥

**影响范围：** `src/routes/auth.ts`、`src/index.ts`

**修复方案：**

1. 修复 session 固定 —— 登录成功时重新生成 session：
```ts
// auth.ts POST /api/login 中，密码验证通过后
req.session.regenerate((err) => {
  if (err) return res.status(500).send("登录失败");
  req.session.userId = user.id;
  req.session.isAdmin = !!user.isAdmin;
  req.session.save(() => res.redirect("/courses"));
});
```

2. 替换硬编码 session secret —— 从环境变量读取：
```ts
// index.ts
const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  console.error("SESSION_SECRET 环境变量未设置，请设置后再启动");
  process.exit(1);
}
```

3. 添加 `.env.example` 文件，标明需要配置的环境变量。

---

## P1 - 尽快修复（业务逻辑漏洞）

### #7 选课不限制最大选课数

**影响范围：** `src/routes/courses.ts:63-118`

**修复方案：**

在选课事务中增加已选课程数量检查：

```ts
db.transaction((tx) => {
  // 检查最大选课数
  const currentCount = tx
    .select({ count: count() })
    .from(selections)
    .where(eq(selections.userId, userId))
    .get();
  if (currentCount && currentCount.count >= MAX_SELECTIONS) {
    throw new Error(`最多只能选 ${MAX_SELECTIONS} 门课`);
  }
  // ... 后续检查
});
```

`MAX_SELECTIONS` 可先硬编码（如 3），后期改为从 config 表读取。

**额外需要：** config 表中新增一条 `max_selections` 配置项，在 `src/routes/admin-courses.ts` 的配置编辑页面中增加此项。

---

### #8 退课不检查截止时间

**影响范围：** `src/routes/courses.ts:120-172`

**修复方案：**

在退课事务的 `opentime` 检查附近，增加 `endTime` 检查：

```ts
db.transaction((tx) => {
  const endTimeRow = tx.select({ value: config.value }).from(config).where(eq(config.key, "end_time")).get();
  const endTime = endTimeRow?.value;
  if (endTime && now >= endTime) throw new Error("选课已截止，无法退课");
  // ... 后续逻辑
});
```

---

### #9 修改课程总名额可能造成负数 / NaN

**影响范围：** `src/routes/admin-courses.ts:62-93`

**修复方案：**

```ts
// 在第78行附近，resetSeats 逻辑处
const totalSeats = req.body.totalSeats;
const newTotal = totalSeats !== undefined ? parseInt(totalSeats) : existing.totalSeats;

// 1. 校验 totalSeats 必须为正整数
if (isNaN(newTotal) || newTotal < 1) {
  return res.status(400).send("总名额必须为大于0的整数");
}

// 2. 校验不能少于当前已选人数
const selectedCount = db
  .select({ count: count() })
  .from(selections)
  .where(eq(selections.courseId, courseId))
  .get()?.count ?? 0;
if (newTotal < selectedCount) {
  return res.status(400).send(`总名额不能小于已选人数（${selectedCount}）`);
}

// 3. availableSeats 使用差值计算而非直接赋值
updateData.availableSeats = newTotal - selectedCount;
```

---

### #4 删除课程的级联操作不在事务中

**影响范围：** `src/routes/admin-courses.ts:95-107`

**修复方案：**

```ts
router.delete("/api/admin/courses/:id", requireAdmin, (req, res) => {
  const courseId = parseInt(req.params.id);
  if (isNaN(courseId) || courseId < 1) return res.status(400).send("无效的课程ID");

  const course = db.select().from(courses).where(eq(courses.id, courseId)).get();
  if (!course) return res.status(404).send("课程不存在");

  db.transaction((tx) => {
    tx.delete(selections).where(eq(selections.courseId, courseId)).run();
    tx.delete(accessUsers).where(eq(accessUsers.accessId,
      inArray(
        tx.select({ id: access.id }).from(access).where(eq(access.courseId, courseId))
      )
    )).run(); // 或先查 accessIds 再批量删
    tx.delete(access).where(eq(access.courseId, courseId)).run();
    tx.delete(courses).where(eq(courses.id, courseId)).run();
  });

  res.redirect("/admin/courses");
});
```

同时也修复 `DELETE /api/admin/users/:id` 的级联删除（同样不在事务中）。

---

### #5 admin 可以删除自己 / 降级自己 / 清空最后一个 admin

**影响范围：** `src/routes/admin-users.ts:56-79`、`src/routes/admin-users.ts:82-93`

**修复方案：**

```ts
// PUT /api/admin/users/:id 中增加
if (userId === req.session.userId && isAdmin === "0") {
  return res.status(400).send("不能取消自己的管理员权限");
}

// DELETE /api/admin/users/:id 中增加
if (userId === req.session.userId) {
  return res.status(400).send("不能删除自己的账户");
}

// 两个接口都加上"最后管理员"检查
const adminCount = db.select({ count: count() }).from(users).where(eq(users.isAdmin, 1)).get()?.count ?? 0;
if (adminCount <= 1 && /* 当前操作会减少一个管理员 */) {
  return res.status(400).send("不能移除最后一个管理员");
}
```

---

### #6 isAdmin 权限不实时校验

**影响范围：** `src/middleware/auth.ts`

**修复方案：**

`requireAdmin` 中间件增加数据库回查：

```ts
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) return res.redirect("/login");

  const user = db.select({ isAdmin: users.isAdmin })
    .from(users)
    .where(eq(users.id, req.session.userId))
    .get();

  if (!user || !user.isAdmin) {
    req.session.isAdmin = false;
    return res.redirect("/login");
  }
  next();
}
```

---

## P2 - 应该修复（输入校验 / XSS）

### #10 创建课程接受空名称和 0 名额

**影响范围：** `src/routes/admin-courses.ts:44-59`

**修复方案：**

```ts
router.post("/api/admin/courses", requireAdmin, (req, res) => {
  const { name, teacher, openTime } = req.body;
  const totalSeats = parseInt(req.body.totalSeats);

  // 校验必填字段
  const errors: string[] = [];
  if (!name || !name.trim()) errors.push("课程名称不能为空");
  if (!teacher || !teacher.trim()) errors.push("授课教师不能为空");
  if (isNaN(totalSeats) || totalSeats < 1) errors.push("总名额必须为大于0的整数");
  if (!openTime || isNaN(Date.parse(openTime))) errors.push("开放时间格式不正确");

  if (errors.length > 0) {
    return res.status(400).send(errors.join("；"));
  }

  // ... 插入逻辑
});
```

---

### #11 配置更新无校验

**影响范围：** `src/routes/admin-courses.ts:109-117`

**修复方案：**

```ts
const ALLOWED_CONFIG_KEYS = ["end_time", "site_title", "max_selections"];

router.put("/api/admin/config", requireAdmin, (req, res) => {
  const { key, value } = req.body;

  if (!ALLOWED_CONFIG_KEYS.includes(key)) {
    return res.status(400).send("不可修改的配置项");
  }

  // 针对特定 key 做格式校验
  if (key === "end_time" && value && isNaN(Date.parse(value))) {
    return res.status(400).send("截止时间格式不正确");
  }
  if (key === "max_selections" && (isNaN(parseInt(value)) || parseInt(value) < 1)) {
    return res.status(400).send("最大选课数必须为正整数");
  }

  db.insert(config).values({ key, value: value || "" })
    .onConflictDoUpdate({ target: config.key, set: { value: value || "" } })
    .run();
  res.redirect("/admin/courses");
});
```

---

### #12 创建用户密码无强度要求

**影响范围：** `src/routes/admin-users.ts:37-53`

**修复方案：**

```ts
router.post("/api/admin/users", requireAdmin, (req, res) => {
  let { username, password } = req.body;
  const isAdmin = req.body.isAdmin === "1" ? 1 : 0;

  username = (username || "").trim();
  const errors: string[] = [];

  if (!username) errors.push("用户名不能为空");
  if (username.length < 3 || username.length > 50) errors.push("用户名长度3-50位");
  if (!/^[a-zA-Z0-9_]+$/.test(username)) errors.push("用户名只能包含字母、数字和下划线");
  if (!password || password.length < 6) errors.push("密码至少6位");

  if (errors.length > 0) {
    return res.status(400).send(errors.join("；"));
  }

  // ... 插入逻辑
});
```

---

### #13 创建特殊开放时间不校验外部实体

**影响范围：** `src/routes/admin-access.ts:47-71`

**修复方案：**

1. 插入前校验 course 和 users 是否存在：

```ts
router.post("/api/admin/access", requireAdmin, (req, res) => {
  const courseId = parseInt(req.body.course_id);
  const openTime = req.body.open_time;
  const userIds = (req.body.user_ids || "").split(",").map((s: string) => s.trim()).filter(Boolean);

  if (isNaN(courseId) || courseId < 1) return res.status(400).send("无效的课程ID");
  if (!openTime || isNaN(Date.parse(openTime))) return res.status(400).send("无效的开放时间");
  if (userIds.length === 0) return res.status(400).send("至少选择一个学生");

  // 校验课程存在
  const course = db.select().from(courses).where(eq(courses.id, courseId)).get();
  if (!course) return res.status(400).send("课程不存在");

  // 校验用户存在并去重
  const uniqueIds = [...new Set(userIds.map(Number).filter(id => !isNaN(id) && id > 0))];
  const validUsers = db.select({ id: users.id }).from(users)
    .where(and(eq(users.isAdmin, 0), inArray(users.id, uniqueIds)))
    .all();
  const validIds = validUsers.map(u => u.id);

  if (validIds.length === 0) return res.status(400).send("没有有效的学生ID");

  // 插入操作放进事务
  db.transaction((tx) => {
    const result = tx.insert(access).values({ courseId, openTime }).run();
    if (result.lastInsertRowid) {
      tx.insert(accessUsers).values(
        validIds.map(userId => ({ accessId: Number(result.lastInsertRowid), userId }))
      ).run();
    }
  });

  res.redirect("/admin/access");
});
```

---

### #14 批量导入时无效 ID 静默丢弃

**影响范围：** `src/routes/admin-class.ts:50-124`

**修复方案：**

```ts
const invalidIds = uniqueIds.filter(
  id => !validIds.includes(id)
);

// ... 处理完毕后
if (invalidIds.length > 0) {
  // 在响应中携带警告信息
  res.set("HX-Trigger", JSON.stringify({
    toast: { message: `以下ID不存在，已忽略：${invalidIds.join("、")}`, type: "warning" }
  }));
}
```

用于配合 layout.ejs 中的 toast 组件展示警告。

---

### #16 错误信息泄露业务逻辑

**影响范围：** `src/routes/courses.ts`

**修复方案：**

将具体错误信息改为通用提示：

```ts
if (now < opentime) throw new Error("选课失败");       // 原："尚未到开放时间"
if (endTime && now >= endTime) throw new Error("选课失败"); // 原："选课已截止"
if (course.availableSeats <= 0) throw new Error("名额已满");
```

同时建议在后端日志中记录详细原因，但只向客户端返回通用错误。

---

### #17 ID 参数未校验 NaN / 负数

**影响范围：** 所有路由

**修复方案：**

在每个路由开头统一校验：

```ts
const courseId = parseInt(req.params.id);
if (isNaN(courseId) || courseId < 1) {
  return res.status(400).send("无效的ID");
}
```

可以抽取一个工具函数 `src/utils/parse-id.ts`：

```ts
export function parseRouteId(param: string): number | null {
  const id = parseInt(param);
  return (!isNaN(id) && id > 0) ? id : null;
}
```

所有路由统一调用，返回 null 时直接 400。

---

### #19 renderResult HTML 拼接未转义

**影响范围：** `src/routes/admin-class.ts` 的 `renderResult()` 和 `renderBadgesReadOnly()` 函数

**修复方案：**

不使用字符串拼接构建 HTML，改用 EJS `renderFile` 渲染模板；或者如果必须拼接，对变量做 HTML 转义：

```ts
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
```

所有来自数据库的字段在插入 HTML 前调用 `escapeHtml()`。

---

### #23 更新用户时不校验重名

**影响范围：** `src/routes/admin-users.ts:56-79`

**修复方案：**

```ts
if (username) {
  const existing = db.select().from(users)
    .where(and(eq(users.username, username), ne(users.id, userId)))
    .get();
  if (existing) {
    return res.status(400).send("用户名已被其他用户使用");
  }
}
```

---

## P3 - 有余力修复（安全增强 / 性能优化）

### #15 课程时间重叠检查

**影响范围：** `src/routes/courses.ts`

**修复方案：**

选课时检查同一学生已选课程是否与当前课程时间重叠。由于 `courseTime` 目前是自由文本字段，建议先规范化时间格式（如 `"周一 08:00-10:00"` 改为结构化字段），或暂时只做字符串比较提示。

---

### #18 全量加载无分页

**修复方案：**

所有列表接口增加 `page` 和 `limit` 查询参数（默认值 `page=1, limit=50`）：

```ts
const page = Math.max(1, parseInt(req.query.page as string) || 1);
const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
const offset = (page - 1) * limit;

const courses = db.select().from(courses).limit(limit).offset(offset).all();
const total = db.select({ count: count() }).from(courses).get()?.count ?? 0;
const totalPages = Math.ceil(total / limit);
```

前端配合 HTMX 的分页触发或滚动加载。

---

### #20 无请求体大小限制

**修复方案：**

在 `src/index.ts` 中配置：

```ts
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
```

---

### #21 无安全头

**修复方案：**

安装 helmet：

```bash
npm install helmet
```

在 `src/index.ts` 中：

```ts
import helmet from "helmet";
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://unpkg.com"], // HTMX 需要
      styleSrc: ["'self'", "'unsafe-inline'"],
    },
  },
}));
```

---

### #22 无审计日志

**修复方案：**

增加一个 `audit_log` 表：

```ts
// src/db/schema.ts
export const auditLog = sqliteTable("audit_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  action: text("action").notNull(),       // 如 "delete_course", "create_user"
  targetId: integer("target_id"),
  detail: text("detail"),                 // JSON 格式的变更详情
  createdAt: text("created_at").notNull(),
});
```

在所有 admin 操作的 API 中增加日志写入：

```ts
db.insert(auditLog).values({
  userId: req.session.userId,
  action: "delete_course",
  targetId: courseId,
  detail: JSON.stringify({ courseName: course.name }),
  createdAt: nowLocal(),
}).run();
```

---

### #24 无频率限制（暴力破解防护）

**修复方案：**

安装 express-rate-limit：

```bash
npm install express-rate-limit
```

在 `src/index.ts` 中：

```ts
import rateLimit from "express-rate-limit";

// 全局限制
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
}));

// 登录接口更严格限制
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: "登录尝试次数过多，请15分钟后再试",
});
app.use("/api/login", loginLimiter);
```

---

### #25 搜索仅支持精确匹配

**修复方案：**

将精确匹配 `eq` 改为模糊匹配 `like`：

```ts
db.select().from(courses).where(like(courses.name, `%${name}%`)).all();
db.select().from(users).where(like(users.username, `%${username}%`)).all();
```

---

### #26 数据库缺少 CHECK 约束

**修复方案：**

在后续数据库迁移中加入：

```sql
-- SQLite 不直接支持 ALTER TABLE ADD CONSTRAINT，需要重建表或在应用层做
-- 方案：在插入/更新时增加应用层校验（已在上述各项中覆盖）
```

由于 SQLite 的限制，CHECK 约束建议在应用层统一处理，已在 P2 的各项输入校验中覆盖。

---

## 修复顺序建议

```
第1轮（1-2天）：
  └── P0: #1 事务修复 、#3 Session 固定 、#2 CSRF

第2轮（2-3天）：
  └── P1: #7 最大选课数 、#8 退课时限 、#9 名额非负数 、#4 #5 级联/自操作保护 、#6 权限实时校验

第3轮（2-3天）：
  └── P2: #10 #11 #12 #13 各项输入校验 、#17 ID 校验 、#19 XSS 、#23 重名校验

第4轮（按需）：
  └── P3: #18 分页 、#20-26 安全增强
```
