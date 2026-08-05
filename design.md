# 抢课系统设计方案

## 1. 技术栈

| 层 | 技术 | 说明 |
|---|---|---|
| 语言 | TypeScript 5.x | 类型安全 |
| 运行时 | tsx | 直接跑 `.ts`，免编译 |
| Web 框架 | Express.js | 最小、最熟 |
| ORM | Drizzle ORM | 类 SQL API、零代码生成、支持 `FOR UPDATE` |
| 数据库驱动 | better-sqlite3 | SQLite WAL 模式、同步 API 简单直接 |
| 模板引擎 | EJS | `<%= %>` 拼 HTML，跟写 HTML 没区别 |
| Session | express-session + connect-sqlite3 | Cookie-Session 一行配置 |
| 密码 | bcryptjs | 纯 JS 无 C++ 依赖 |
| 交互 | HTMX 2.x (CDN) | 抢课按钮无刷新局部更新 |
| CSS | Pico CSS (CDN) | 响应式、移动端原生体验 |

**依赖总数 ~12 个包。** 没有 webpack、没有 vite、没有构建——`npm run dev` 直接跑。

---

## 2. 业务流程

### 2.1 管理员流程

```
第1步：创建课程
  进入 /admin/courses
   填写课程信息 → 课程名、教师、课程描述、上课时间、上课地点、总名额
   设置"默认开放时间"（即大多数人能开始抢这门课的时间）
   例：Python入门  周二第3-5节  默认开放时间 2026-08-10 09:00  总名额60

第2步：设置全局截止时间
  在 /admin/courses 页面顶部的配置区
  设置 end_time（整个平台所有课程的最终截止时间）
  过了这个时间，所有人都不能再抢/退课

第3步：设置提前批（可选）
  进入 /admin/access
  新建一个 access 组 → 选择课程 + 设置 opentime
  从学生列表中勾选要提前开放的学生
  例：Python入门 → opentime 2026-08-09 12:00 → 勾选张三、李四、王五
  提交后，张三/李四/王五比其他人提前21小时抢这门课

  可以建多个 access 组。同一门课可以有多个提前批次（不同的 opentime + 不同的人）

第4步：管理用户（可选）
  进入 /admin/users
  可以手动添加学生账号、重置密码等
```

### 2.2 学生流程

```
第1步：登录
  打开页面 → /login
  输入用户名密码 → 登录成功跳转到 /courses

第2步：查看课程
   每门课显示：
      - 课程名、教师、上课时间、上课地点、课程描述、剩余名额/总名额
    - 一个按钮，状态取决于当前时间和该学生的 opentime
      ① 还没到 opentime → 灰色按钮 + 显示倒计时"07:30后开放"
      ② opentime ≤ now < end_time 且名额 > 0 且未选过 → 绿色"抢课"
      ③ 已选过这门课 → 蓝色"已选 ✓"，不可点击
      ④ 名额=0 → 灰色"已满"
      ⑤ now ≥ end_time → 灰色"已截止"

第3步：抢课
  按钮变绿后，点击"抢课"
  → 后端检查：opentime 到了? 未截止? 名额>0?
  → 成功 → 按钮变"已选 ✓"，名额-1
  → 失败 → 显示错误提示（名额已满/已截止等）

第4步：查看我的选课
  进入 /selections
  列出已选课程，可以退课（退课后名额+1）
```

### 2.3 opentime 优先级规则

```
查学生某门课的 opentime：
  ① 查 access 表 JOIN access_users
     → 有记录 → 用 access.open_time（提前批）
     → 无记录 → 用 courses.open_time（默认时间）
```

---

## 3. 数据库设计

### 3.1 ER 关系

```
users 1──N selections
courses 1──N selections
courses 1──N access
access 1──N access_users
access_users N──1 users
```

Session 表由 `connect-sqlite3` 自动创建管理，`config` 是 key-value 单表。

### 3.2 表结构

```sql
CREATE TABLE users (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    username   TEXT    NOT NULL UNIQUE,
    password   TEXT    NOT NULL,   -- bcryptjs hash
    is_admin   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE courses (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT    NOT NULL,
    teacher         TEXT    NOT NULL,
    description     TEXT,
    course_time     TEXT,           -- 上课时间，如"周二第3-5节"
    location        TEXT,           -- 上课地点，如"教学楼A-301"
    total_seats     INTEGER NOT NULL,
    available_seats INTEGER NOT NULL,
    open_time       TEXT    NOT NULL  -- 默认开放时间 (ISO 8601)
);

CREATE TABLE access (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    course_id  INTEGER NOT NULL REFERENCES courses(id),
    open_time  TEXT    NOT NULL  -- 本批次的开放时间
);

CREATE TABLE access_users (
    access_id INTEGER NOT NULL REFERENCES access(id),
    user_id   INTEGER NOT NULL REFERENCES users(id),
    PRIMARY KEY (access_id, user_id)
);

CREATE TABLE selections (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id),
    course_id  INTEGER NOT NULL REFERENCES courses(id),
    created_at TEXT    NOT NULL,
    UNIQUE(user_id, course_id)
);

CREATE TABLE config (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
```

**示例数据：**

```sql
-- 全局截止时间
INSERT INTO config VALUES ('end_time', '2026-08-15T23:59:59');

-- 两门课，默认开放时间不同
INSERT INTO courses VALUES (1, 'Python入门', '张老师', '零基础Python教学', '周二第3-5节', '教学楼A-301', 60, 60, '2026-08-10T09:00:00');
INSERT INTO courses VALUES (2, 'Go语言',   '李老师', 'Go并发编程实践', '周三第6-8节', '教学楼B-205', 40, 40, '2026-08-11T09:00:00');

-- Python入门 提前批：张三、李四 8月9号12点就能抢
INSERT INTO access VALUES (1, 1, '2026-08-09T12:00:00');
INSERT INTO access_users VALUES (1, 2), (1, 3);
-- （假设 user.id=2 是张三, user.id=3 是李四）
```

### 3.3 Drizzle Schema

```ts
// src/db/schema.ts

import { sqliteTable, integer, text, primaryKey } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  isAdmin: integer("is_admin").notNull().default(0),
});

export const courses = sqliteTable("courses", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  teacher: text("teacher").notNull(),
  description: text("description"),
  courseTime: text("course_time"),
  location: text("location"),
  totalSeats: integer("total_seats").notNull(),
  availableSeats: integer("available_seats").notNull(),
  openTime: text("open_time").notNull(),
});

export const access = sqliteTable("access", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  courseId: integer("course_id").notNull().references(() => courses.id),
  openTime: text("open_time").notNull(),
});

export const accessUsers = sqliteTable("access_users", {
  accessId: integer("access_id").notNull().references(() => access.id),
  userId: integer("user_id").notNull().references(() => users.id),
}, (table) => ({
  pk: primaryKey({ columns: [table.accessId, table.userId] }),
}));

export const selections = sqliteTable("selections", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull().references(() => users.id),
  courseId: integer("course_id").notNull().references(() => courses.id),
  createdAt: text("created_at").notNull(),
}, (table) => ({
  uniq: { unique: true, columns: [table.userId, table.courseId] },
}));

export const config = sqliteTable("config", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
```

---

## 4. 文件结构

```
elective-system/
├── package.json
├── tsconfig.json
├── design.md
│
├── src/
│   ├── index.ts               # Express 入口
│   │
│   ├── db/
│   │   ├── schema.ts          # Drizzle 表定义
│   │   ├── index.ts           # DB 初始化 + 连接导出
│   │   └── seed.ts            # 种子数据（管理员账号）
│   │
│   ├── middleware/
│   │   └── auth.ts            # requireAuth / requireAdmin
│   │
│   ├── routes/
│   │   ├── auth.ts            # 登录/退出
│   │   ├── courses.ts         # 学生端：课程列表、抢课、退课
│   │   ├── selections.ts      # 学生端：我的选课
│   │   ├── admin-courses.ts   # 管理端：课程 CRUD + 全局 config
│   │   ├── admin-access.ts    # 管理端：access 组管理
│   │   ├── admin-users.ts     # 管理端：用户管理
│   │   └── pages.ts           # 页面 GET 路由
│   │
│   ├── views/
│   │   ├── layout.ejs         # 公共布局（head + 导航）
│   │   ├── login.ejs          # 登录页
│   │   ├── courses.ejs        # 学生端：课程列表
│   │   ├── selections.ejs     # 学生端：我的选课
│   │   ├── admin-courses.ejs  # 管理端：课程管理
│   │   ├── admin-access.ejs   # 管理端：access 组管理
│   │   └── admin-users.ejs    # 管理端：用户管理
│   │
│   └── types/
│       └── express.d.ts
│
├── data/                      # (gitignore) SQLite 数据库
└── drizzle.config.ts
```

---

## 5. 后端路由

### 5.1 页面路由（GET，返回 HTML）

| 路径 | 说明 | 鉴权 |
|---|---|---|
| `/login` | 登录页 | 否 |
| `/` | 首页，302 跳转 /courses 或 /admin/courses | 是 |
| `/courses` | 学生课程列表 | 学生 |
| `/selections` | 我的选课 | 学生 |
| `/admin/courses` | 课程 + 全局配置管理 | 管理员 |
| `/admin/access` | access 组管理 | 管理员 |
| `/admin/users` | 用户管理 | 管理员 |

### 5.2 API 路由

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/login` | 登录 |
| POST | `/api/logout` | 退出 |
| POST | `/api/courses/:id/select` | 抢课，返回该课程卡片的 HTML partial |
| POST | `/api/courses/:id/drop` | 退课，返回该课程卡片的 HTML partial |
| POST | `/api/admin/courses` | 新建课程 |
| PUT | `/api/admin/courses/:id` | 编辑课程 |
| DELETE | `/api/admin/courses/:id` | 删除课程 |
| PUT | `/api/admin/config` | 更新全局配置（end_time） |
| POST | `/api/admin/access` | 新建 access 组（含 access_users） |
| PUT | `/api/admin/access/:id` | 编辑 access 组 |
| DELETE | `/api/admin/access/:id` | 删除 access 组（级联删 access_users） |
| POST | `/api/admin/users` | 新建用户 |
| PUT | `/api/admin/users/:id` | 编辑用户 |
| DELETE | `/api/admin/users/:id` | 删除用户 |

---

## 6. 抢课核心逻辑

```ts
async function selectCourse(userId: number, courseId: number) {
  return db.transaction(() => {
    // 1. 锁定课程行，防超卖
    const course = db.select().from(courses)
      .where(eq(courses.id, courseId))
      .for("update").get();

    if (!course) throw new Error("课程不存在");

    // 2. 查该生这门课的 opentime
    const openTime = getOpenTimeForUser(db, userId, courseId);

    // 3. 查全局 end_time
    const endTime = getConfig("end_time");
    const now = new Date().toISOString();

    // 4. 校验时间窗口
    if (now < openTime)  throw new Error("未到开放时间");
    if (now >= endTime)  throw new Error("已截止");

    // 5. 校验名额
    if (course.availableSeats <= 0) throw new Error("名额已满");

    // 6. 校验是否已选（唯一约束兜底）
    const exists = db.select().from(selections)
      .where(and(eq(selections.userId, userId), eq(selections.courseId, courseId)))
      .get();
    if (exists) throw new Error("已选过该课程");

    // 7. 扣名额
    db.update(courses)
      .set({ availableSeats: course.availableSeats - 1 })
      .where(eq(courses.id, courseId)).run();

    // 8. 写选课记录
    db.insert(selections).values({
      userId, courseId, createdAt: now,
    }).run();
  });
}
```

---

## 7. 前端页面

### 7.1 登录页 `/login`

- 卡片居中布局，表单提交
- 失败时同一页面显示错误提示

### 7.2 学生端：课程列表 `/courses`

- 导航：`课程列表` | `我的选课` | `退出`
- 每门课一个卡片：
  - 课程名、教师、上课时间、上课地点、课程描述、**剩余名额 / 总名额**
  - 按钮状态（根据 opentime + end_time + 名额 + 是否已选 决定）：
    - **未开放** → 灰色 + 倒计时（JS 每秒更新）
    - **可抢** → 绿色抢课按钮
    - **已选** → 蓝色"已选 ✓"
    - **已满** → 灰色"已满"
    - **已截止** → 灰色"已截止"
- 抢课按钮用 HTMX：
  ```html
  <button hx-post="/api/courses/3/select" hx-target="#card-3" hx-swap="outerHTML">
    抢课
  </button>
  ```
  后端返回整张卡片的新 HTML，替换整个卡片（按钮+名额一次性全部更新）
- 倒计时用一段小 `<script>`，纯 DOM 操作

### 7.3 学生端：我的选课 `/selections`

- 表格列出已选：课程名、教师、上课时间、地点、选课时间、**退课按钮**
- 退课 → HTMX 移除该行

### 7.4 管理端：课程管理 `/admin/courses`

- 顶部：全局 `end_time` 设置（一个表单，修改后即时生效）
- 下方：课程表格 —— 课程名、教师、上课时间、地点、默认 open_time、名额（已选/总）、编辑/删除
- 新建课程表单（内联或弹窗）
- 重置名额按钮：把 `available_seats` 设回 `total_seats`

### 7.5 管理端：access 管理 `/admin/access`

- 表格列出所有 access 组：课程名、opentime、包含的学生数、编辑/删除
- 新建 access 组：
  1. 选择课程（下拉框）
  2. 设置 opentime（datetime input）
  3. 勾选学生（多选框列表）
  4. 提交
- 编辑 access 组：修改 opentime 和成员

### 7.6 管理端：用户管理 `/admin/users`

- 表格列出所有用户：用户名、角色（管理员/学生）、编辑/删除
- 新建用户表单

### 7.7 响应式

Pico CSS 默认响应式，所有页面在手机上自动适配。

---

## 8. 鉴权

`express-session` + `connect-sqlite3` 自动管理 Cookie-Session。

```ts
// middleware/auth.ts

export function requireAuth(req, res, next) {
  if (!req.session.userId) return res.redirect("/login");
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.session.userId || !req.session.isAdmin) return res.redirect("/login");
  next();
}
```

登录时 `req.session.userId = user.id; req.session.isAdmin = user.isAdmin`，之后中间件自动注入。

---

## 9. 并发策略

- SQLite WAL 模式：读不阻塞写
- better-sqlite3 单连接，写操作天然串行
- 抢课走事务 + `FOR UPDATE` 行锁，50 人同时抢同一门课也是排队执行
- `selections` 表 `UNIQUE(user_id, course_id)` 防止重复抢

---

## 10. 初始数据

**管理员：** `admin` / `admin123`（`seed.ts` 启动时 bcryptjs 写入）

---

## 11. 部署

```bash
npm run dev       # 开发：tsx watch src/index.ts
npm start         # 生产：tsx src/index.ts
```

端口 8080，前面套 Nginx/Caddy 反代 + SSL。

---

## 12. 依赖

```json
{
  "dependencies": {
    "express": "^4.21",
    "express-session": "^1.18",
    "connect-sqlite3": "^0.9",
    "drizzle-orm": "^0.38",
    "better-sqlite3": "^11.7",
    "ejs": "^3.1",
    "bcryptjs": "^2.4"
  },
  "devDependencies": {
    "typescript": "^5.7",
    "tsx": "^4.19",
    "drizzle-kit": "^0.30",
    "@types/express": "^5.0",
    "@types/express-session": "^1.18",
    "@types/better-sqlite3": "^7.6",
    "@types/bcryptjs": "^2.4",
    "@types/ejs": "^3.1"
  },
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "start": "tsx src/index.ts"
  }
}
```
