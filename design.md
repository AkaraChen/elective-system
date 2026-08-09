# 选课系统设计方案

## 1. 技术选型

| 层 | 技术 | 选型理由 |
|---|---|---|
| 语言 | TypeScript 5 | 类型安全 |
| 运行时 | tsx | 直接运行 `.ts` 文件，免编译步骤 |
| Web 框架 | Express.js | 最小、最熟悉 |
| ORM | Drizzle ORM | 类 SQL API、零代码生成、SQLite 方言完善 |
| 数据库 | SQLite（better-sqlite3） | 单文件、WAL 模式、同步 API 简单直接 |
| 模板引擎 | EJS | `<%= %>` 拼 HTML，与写 HTML 无异 |
| Session | express-session + 自定义 better-sqlite3 store | `connect-sqlite3` 与该异步 API 不兼容，自建同步 store |
| 密码 | bcryptjs | 纯 JS，无 C++ 编译依赖 |
| CSS | Tailwind CSS 3 | 实用优先的原子化 CSS |
| 交互 | HTMX 2.x（CDN） | 抢课按钮无刷新局部更新 |
| Dev | concurrently | 同时运行 CSS watch 和 tsx watch |

## 2. 业务流程

### 2.1 角色

- **管理员**：创建课程、设置全局截止时间、管理提前批次（为指定学生设置更早的开放时间）、管理用户
- **学生**：登录后查看课程列表，到达开放时间后抢课，查看已选课程并退课

### 2.2 管理员流程

```
创建课程 → 填写课程名、教师、描述、上课时间、地点、总名额、默认开放时间
设置全局截止时间 → 所有课程选课的统一截止时间（end_time）
设置提前批次 → 选择课程 + 设置更早的开放时间 + 勾选学生
管理用户 → 增删改查管理员和学生账号
班级管理 → 查询课程已选学生、批量导入选课名单
```

### 2.3 学生流程

```
登录 → 进入课程列表
课程卡片显示：课程名、教师、上课时间、地点、描述、剩余名额/总名额
按钮状态取决于时间和名额：
  ① 未到开放时间 → 灰色 + 倒计时
  ② 已开放且有名额且未选 → 绿色「抢课」
  ③ 已选 → 蓝色「已选 ✓」
  ④ 名额已满 → 灰色「已满」
  ⑤ 已截止 → 灰色「已截止」
抢课 → HTMX POST，成功后按钮变为「已选 ✓」、名额即时更新
退课 → 在「我的选课」页操作
```

### 2.4 开放时间优先级

每个学生对每门课都有一个有效开放时间 `opentime`：

1. 查 `access` 表 JOIN `access_users` 是否有匹配记录 → 有则用 `access.open_time`
2. 否则用 `courses.open_time`（默认开放时间）

## 3. 数据库设计

### 3.1 ER 关系

```
users  1────N  selections  N────1  courses
users  1────N  access_users  N────1  access  N────1  courses
```

### 3.2 表结构

```sql
CREATE TABLE users (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    username  TEXT    NOT NULL UNIQUE,
    password  TEXT    NOT NULL,     -- bcryptjs hash
    is_admin  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE courses (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    name             TEXT    NOT NULL,
    teacher          TEXT    NOT NULL,
    description      TEXT,
    course_time      TEXT,          -- 上课时间，如 "周二第3-5节"
    location         TEXT,          -- 上课地点，如 "教学楼A-301"
    total_seats      INTEGER NOT NULL,
    available_seats  INTEGER NOT NULL,
    open_time        TEXT    NOT NULL  -- ISO 8601 本地时间格式
);

CREATE TABLE access (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    course_id  INTEGER NOT NULL REFERENCES courses(id),
    open_time  TEXT    NOT NULL    -- 本批次的开放时间
);

CREATE TABLE access_users (
    access_id  INTEGER NOT NULL REFERENCES access(id),
    user_id    INTEGER NOT NULL REFERENCES users(id),
    PRIMARY KEY (access_id, user_id)
);

CREATE TABLE selections (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id),
    course_id   INTEGER NOT NULL REFERENCES courses(id),
    created_at  TEXT    NOT NULL,
    UNIQUE(user_id, course_id)
);

CREATE TABLE config (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL
);

-- sessions 表由自定义 SessionStore 自动创建管理
```

### 3.3 Drizzle Schema

```ts
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
  uniq: unique().on(table.userId, table.courseId),
}));

export const config = sqliteTable("config", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
```

### 3.4 种子数据

| 账号 | 密码 | 角色 |
|---|---|---|
| admin | 123 | 管理员 |
| student | 123 | 学生 |

课程：Python入门（60 名额，2026-08-10 09:00 开放）、Go语言（40 名额，2026-08-11 09:00 开放）

提前批次：Python入门对 student 提前到 2026-08-09 12:00 开放

配置：`end_time` = 2026-08-15 23:59:59，`site_title` = 选课系统，`max_selections` = 1

## 4. 文件结构

```
elective-system/
├── package.json
├── tsconfig.json
├── tailwind.config.js
├── drizzle.config.ts
├── src/
│   ├── index.ts                 # Express 入口
│   ├── css/
│   │   └── input.css            # Tailwind CSS 入口
│   ├── db/
│   │   ├── index.ts             # DB 连接（WAL 模式）
│   │   ├── schema.ts            # Drizzle 表定义
│   │   └── seed.ts              # 种子数据
│   ├── lib/
│   │   └── session-store.ts     # 自定义 Session Store
│   ├── middleware/
│   │   └── auth.ts              # requireAuth / requireAdmin
│   ├── routes/
│   │   ├── auth.ts              # POST /api/login、POST /api/logout
│   │   ├── pages.ts             # GET 页面路由
│   │   ├── courses.ts           # GET /courses、POST select/drop
│   │   ├── selections.ts        # GET /selections
│   │   ├── admin-courses.ts     # 课程 CRUD + 全局配置
│   │   ├── admin-access.ts      # 提前批次管理
│   │   ├── admin-users.ts       # 用户管理
│   │   └── admin-class.ts       # 班级/名单管理
│   ├── utils/
│   │   ├── parse-id.ts          # 路由 ID 安全解析
│   │   └── time.ts              # 时间工具函数
│   ├── types/
│   │   └── express.d.ts         # Session 类型扩展
│   └── views/
│       ├── layout.ejs           # 主布局
│       ├── login.ejs            # 登录页
│       ├── courses.ejs          # 课程列表
│       ├── _course-card.ejs     # 课程卡片组件
│       ├── selections.ejs       # 我的选课
│       ├── admin-courses.ejs    # 课程管理
│       ├── admin-access.ejs     # 提前批次管理
│       ├── admin-users.ejs      # 用户管理
│       ├── admin-class.ejs      # 班级管理
│       ├── _user-row.ejs        # 用户行组件
│       └── _components/         # 通用组件（badge/button/card/empty-state/form-field/toast）
├── public/
│   └── style.css                # Tailwind CSS 输出（由 build:css 生成，已 gitignore）
├── data/                        # SQLite 数据库文件（已 gitignore）
└── test/
    ├── integration.ts           # 集成测试
    └── concurrent.ts            # 并发测试
```

## 5. 路由设计

### 5.1 页面路由

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/login` | 否 | 登录页 |
| GET | `/` | 是 | 首页，管理员跳转 `/admin/courses`，学生跳转 `/courses` |
| GET | `/courses` | 学生 | 课程列表 |
| GET | `/selections` | 学生 | 我的选课 |
| GET | `/admin/courses` | 管理员 | 课程管理 + 全局配置 |
| GET | `/admin/access` | 管理员 | 提前批次管理 |
| GET | `/admin/users` | 管理员 | 用户管理 |
| GET | `/admin/class` | 管理员 | 班级/名单管理 |

### 5.2 API 路由

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/login` | 登录 |
| POST | `/api/logout` | 退出 |
| POST | `/api/courses/:id/select` | 抢课，返回课程卡片 HTML 片段 |
| POST | `/api/courses/:id/drop` | 退课，返回课程卡片 HTML 片段 |
| POST | `/api/admin/courses` | 新建课程 |
| PUT | `/api/admin/courses/:id` | 编辑课程 |
| DELETE | `/api/admin/courses/:id` | 删除课程（事务内级联删相关数据） |
| PUT | `/api/admin/config` | 更新全局配置 |
| POST | `/api/admin/access` | 新建提前批次 |
| PUT | `/api/admin/access/:id` | 编辑提前批次 |
| DELETE | `/api/admin/access/:id` | 删除提前批次 |
| GET | `/api/admin/users/search` | 按用户名搜索学生（HTMX） |
| POST | `/api/admin/users` | 新建用户 |
| PUT | `/api/admin/users/:id` | 编辑用户 |
| DELETE | `/api/admin/users/:id` | 删除用户（事务内级联删相关数据） |
| GET | `/api/admin/class/courses/search` | 按课程名搜索课程及选课名单（HTMX） |
| PUT | `/api/admin/class/courses/:id/students` | 批量导入课程选课名单 |

## 6. 抢课核心逻辑

```ts
function selectCourse(userId, courseId) {
  db.transaction((tx) => {
    // 1. 查询课程
    const course = tx.select().from(courses).where(eq(courses.id, courseId)).get();
    if (!course) throw new Error("课程不存在");

    // 2. 检查最大选课数
    const currentCount = tx.select({ count: count() }).from(selections)
      .where(eq(selections.userId, userId)).get();
    if (currentCount.count >= maxSelections) throw new Error("最多只能选 N 门课");

    // 3. 获取该生这门课的有效开放时间
    const opentime = getOpenTimeForUser(tx, userId, courseId);

    // 4. 获取全局截止时间
    const endTime = tx.select({ value: config.value }).from(config)
      .where(eq(config.key, "end_time")).get()?.value;
    const now = nowLocal();

    // 5. 时间窗口校验
    if (now < opentime) throw new Error("尚未到开放时间");
    if (endTime && now >= endTime) throw new Error("选课已截止");
    if (course.availableSeats <= 0) throw new Error("没有剩余名额");

    // 6. 重复选课校验（由 UNIQUE 约束兜底）
    const existing = tx.select().from(selections)
      .where(and(eq(selections.userId, userId), eq(selections.courseId, courseId))).get();
    if (existing) throw new Error("已选过该课程");

    // 7. 扣名额
    tx.update(courses).set({ availableSeats: course.availableSeats - 1 })
      .where(eq(courses.id, courseId)).run();

    // 8. 写入选课记录
    tx.insert(selections).values({ userId, courseId, createdAt: now }).run();
  });
}
```

退课逻辑类似：事务内检查截止时间，查询是否有选课记录，删除记录并恢复名额。

## 7. 前端页面

### 7.1 登录页

卡片居中布局，渐变背景。表单提交到 `/api/login`，失败时在同一页显示错误提示。

### 7.2 课程列表（学生）

导航栏含「课程列表」「我的选课」「退出」。课程以卡片形式展示：

- 课程名、教师、上课时间、地点、课程描述、剩余名额/总名额
- 按钮根据 `opentime` + `end_time` + 名额 + 是否已选 动态决定状态
- 抢课按钮使用 HTMX：`hx-post="/api/courses/:id/select" hx-target="#card-N" hx-swap="outerHTML"`
- 后端返回整张卡片的 HTML 片段，实现按钮 + 名额的原子更新
- 倒计时使用内联 JS 每秒刷新

### 7.3 我的选课

表格列出已选课程：课程名、教师、上课时间、地点、选课时间、退课按钮。退课通过 HTMX 更新对应卡片。

### 7.4 课程管理（管理员）

页面顶部提供全局配置区：站点标题、截止时间、最大选课数。下方显示课程列表（含已选/总名额），可新建、编辑、删除、重置名额。新建课程默认开放时间为最近的 3 月 1 日或 9 月 1 日。

### 7.5 提前批次管理

表格列出所有批次：课程名、开放时间、包含学生数。可新建、编辑、删除批次。

### 7.6 用户管理

列出所有管理员账号。通过搜索框查找学生，支持新建用户、编辑用户名/密码/角色、删除用户。

### 7.7 班级管理

搜索课程查看已选名单，支持批量导入学生到课程。

## 8. 鉴权

- express-session 管理会话，自定义 better-sqlite3 store 持久化，7 天有效期
- `requireAuth` 中间件：检查 `req.session.userId` 是否存在
- `requireAdmin` 中间件：实时回查数据库 `is_admin` 字段，防止会话劫持后授权信息过时
- CSRF 中间件：GET 请求时生成 token 存入 session 和 `res.locals`，POST/PUT/DELETE 时从 body 的 `_csrf` 字段或 header 的 `x-csrf-token` 验证
- 登录时 `req.session.regenerate()` 防止 session 固定攻击

## 9. 并发策略

- SQLite WAL 模式：读不阻塞写，提升并发读性能
- better-sqlite3 单连接：写操作天然串行化，避免锁竞争
- 抢课/退课所有操作在同一事务内完成，确保原子性
- `selections` 表 `UNIQUE(user_id, course_id)` 约束兜底
- 批量导入选课名单时使用事务，删除旧名单 + 插入新名单原子完成

## 10. 部署

```bash
npm run db:init   # 初始化数据库
npm start         # 编译 CSS + 启动服务
```

端口 8080，前面套 Nginx/Caddy 反代 + SSL。配置环境变量 `SESSION_SECRET` 替换默认 session 密钥。
