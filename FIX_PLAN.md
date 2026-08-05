# 后端验证修复方案

---

## P0 - 立即修复（数据一致性 / 安全性）

### #1 事务回调使用了全局 db 而非事务实例 tx

**当前状态：** `courses.ts` 的选课/退课事务已正确使用 `tx`，但存在以下遗留问题：

**影响范围：** `src/routes/admin-class.ts:91-107`、`src/routes/courses.ts:13-26`（`getOpenTimeForUser` 函数）

**修复方案：**

**A. `admin-class.ts` 批量导入事务 ——** 回调内 `db.xxx()` 全部替换为 `tx.xxx()`：

```ts
admin-class.ts 批量导入改前：
db.transaction(() => {
  db.delete(selections).where(eq(selections.courseId, courseId)).run();
  db.insert(selections).values(...).run();
  db.update(courses).set(...).where(eq(courses.id, courseId)).run();
});

改后：
db.transaction((tx) => {
  tx.delete(selections).where(eq(selections.courseId, courseId)).run();
  tx.insert(selections).values(...).run();
  tx.update(courses).set(...).where(eq(courses.id, courseId)).run();
});
```

**B. `getOpenTimeForUser()` 在事务内读取全局 db ——** 该函数被 `courses.ts` 选课事务内部调用，但内部使用 `db`（全局连接）而非事务传入的 `tx`。修复方式：将该函数改为接受 `db`/`tx` 实例作为参数：

```ts
// 改前
function getOpenTimeForUser(userId: number, courseId: number): string {
  const record = db.select(...).from(access)...;
  ...
}

// 改后
function getOpenTimeForUser(client: typeof db, userId: number, courseId: number): string {
  const record = client.select(...).from(access)...;
  ...
}

// 事务内调用：getOpenTimeForUser(tx, userId, courseId)
// 事务外调用：getOpenTimeForUser(db, userId, courseId)
```

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

**当前进展：** config 表中已有 `max_selections` 配置项，`admin-courses.ts` 页面也已渲染该字段。仅缺选课接口中的实际强制校验，以及 fallback 默认值（config 中未配置时兜底为如 3）。

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

### #16 错误信息可能暴露内部细节

**影响范围：** `src/routes/courses.ts`

> ⚠ 可选修复。对于校内选课系统，"尚未到开放时间" / "选课已截止" 等描述性错误对学生的可用性至关重要，信息泄露风险在该场景下微乎其微。建议仅对内部错误（如 SQL 报错、表名、堆栈）做泛化，保留业务逻辑层面的友好提示。

**修复方案（按需）：**

仅将 catch 块中的 `e.message` 对内部错误做过滤：

```ts
} catch (e: any) {
  // 仅对 SQL / 运行时内部错误做泛化
  const msg = e.message || "";
  const isInternal = msg.includes("SQLITE") || msg.includes("stack") || msg.includes("undefined");
  res.status(400).send(isInternal ? "操作失败，请稍后重试" : msg);
}
```

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



## 修复顺序建议

```
第1轮（1-2天）：
  └── P0: #1 事务修复 、#3 Session 固定 、#2 CSRF

第2轮（2-3天）：
  └── P1: #7 最大选课数 、#8 退课时限 、#9 名额非负数 、#4 #5 级联/自操作保护 、#6 权限实时校验

第3轮（2-3天）：
  └── P2: #10 #11 #13 各项输入校验 、#17 ID 校验 、#19 XSS 、#23 重名校验 、#16 错误信息过滤（可选）
```
