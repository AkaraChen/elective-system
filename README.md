# 选课系统

一个轻量级的高校选课系统。管理员可配置课程和提前批次开放时间，学生到达开放时间后可抢课。基于事务+行锁防止超卖。

## 技术栈

| 层 | 技术 |
|---|---|
| 运行时 | Node.js + TypeScript（tsx 直接运行，免编译） |
| Web 框架 | Express.js 4 |
| ORM | Drizzle ORM |
| 数据库 | SQLite（better-sqlite3，WAL 模式） |
| 模板引擎 | EJS |
| Session | express-session + 自定义 SQLite store |
| 密码 | bcryptjs |
| 前端样式 | Tailwind CSS 3 |
| 前端交互 | HTMX 2.x（CDN） |

## 快速开始

```bash
npm install
npm run db:init
npm run dev
```

打开 http://localhost:8080。

`db:init` 可重复执行：数据库已有用户时会保留现有数据，不会重新写入演示数据。

## 默认账号

| 角色 | 用户名 | 密码 |
|---|---|---|
| 管理员 | admin | admin123 |
| 学生 | student1 | 123456 |
| 学生 | student2 | 123456 |

## 目录结构

```
src/
├── index.ts                 # Express 入口（中间件配置、路由挂载）
├── css/
│   └── input.css            # Tailwind CSS 源文件
├── db/
│   ├── index.ts             # 数据库连接
│   ├── schema.ts            # Drizzle ORM 表结构定义
│   └── seed.ts              # 种子数据
├── lib/
│   └── session-store.ts     # 基于 better-sqlite3 的自定义 Session Store
├── middleware/
│   └── auth.ts              # requireAuth / requireAdmin 鉴权中间件
├── routes/
│   ├── auth.ts              # 登录 / 退出
│   ├── pages.ts             # 页面路由（GET）
│   ├── courses.ts           # 学生端：课程列表、抢课、退课
│   ├── selections.ts        # 学生端：我的选课
│   ├── admin-courses.ts     # 管理端：课程管理 + 全局配置
│   ├── admin-access.ts      # 管理端：提前批次管理
│   ├── admin-users.ts       # 管理端：用户管理
│   └── admin-class.ts       # 管理端：班级/选课名单管理
├── utils/
│   ├── parse-id.ts          # 路由 ID 参数安全解析
│   └── time.ts              # 本地时间格式化工具
├── types/
│   └── express.d.ts         # Session 类型扩展
└── views/
    ├── layout.ejs           # 主布局（导航、toast）
    ├── login.ejs            # 登录页
    ├── courses.ejs          # 课程列表页
    ├── _course-card.ejs     # 课程卡片组件
    ├── selections.ejs       # 我的选课页
    ├── admin-courses.ejs    # 课程管理页
    ├── admin-access.ejs     # 提前批次管理页
    ├── admin-users.ejs      # 用户管理页
    ├── admin-class.ejs      # 班级管理页
    ├── _user-row.ejs        # 用户行组件
    └── _components/         # 通用 UI 组件
        ├── badge.ejs
        ├── button.ejs
        ├── card.ejs
        ├── empty-state.ejs
        ├── form-field.ejs
        └── toast.ejs
```

## 核心功能

### 学生端

- 查看课程列表，显示剩余名额和开放倒计时
- 到达开放时间后点击抢课（HTMX 局部更新）
- 查看已选课程，支持退课

### 管理端

- 课程 CRUD + 重置名额
- 设置全局截止时间 `end_time`
- 管理提前批次（为指定学生对指定课程设置更早的开放时间）
- 用户管理（增删改查、密码重置）
- 班级管理（查看某门课已选学生、批量导入选课名单）
- 站点标题 `site_title` 和最大选课数 `max_selections` 配置

### 开放时间优先级

1. 查询 `access` + `access_users` 是否有该学生的提前批次记录 → 有则使用 `access.open_time`
2. 否则使用 `courses.open_time`（默认开放时间）

## 抢课并发策略

- SQLite WAL 模式：读不阻塞写
- better-sqlite3 单连接，写操作天然串行
- 抢课走事务，检查并扣名额在同一事务内完成
- `selections` 表 `UNIQUE(user_id, course_id)` 防止重复选课

## 可用脚本

```bash
npm run dev              # 开发模式（CSS watch + tsx watch 热重载）
npm start                # 生产模式（先编译 CSS 再启动）
npm run build:css        # 编译 Tailwind CSS
npm run db:push          # 推送 Drizzle schema 到数据库
npm run db:seed          # 写入种子数据
npm run db:init          # db:push + db:seed
npm run typecheck        # TypeScript 类型检查
```

## 部署

```bash
npm run db:init
NODE_ENV=production SESSION_SECRET="请替换为足够长的随机值" npm start
```

端口 8080，前面套 Nginx/Caddy 反代 + SSL。生产模式必须提供 `SESSION_SECRET`，且浏览器只会通过 HTTPS 发送 Session Cookie。
