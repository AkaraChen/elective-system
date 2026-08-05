# 抢课系统

一个轻量级的选课系统，学生可在指定时间抢课，管理员可配置课程、提前批次和用户。

## 技术栈

| 层 | 技术 |
|---|---|
| 运行时 | Node.js + TypeScript (tsx) |
| Web 框架 | Express.js |
| ORM | Drizzle ORM |
| 数据库 | SQLite (better-sqlite3, WAL 模式) |
| 模板引擎 | EJS |
| Session | express-session + SQLite store |
| 前端交互 | HTMX 2.x |
| CSS | Pico CSS |

零构建，`npm run dev` 直接跑。

## 快速开始

```bash
# 安装依赖
npm install

# 初始化数据库（建表 + 种子数据）
npm run db:init

# 启动开发服务器
npm run dev
```

打开 <http://localhost:8080>。

## 默认账号

| 角色 | 用户名 | 密码 |
|---|---|---|
| 管理员 | admin | admin123 |
| 学生 | student1 | 123456 |
| 学生 | student2 | 123456 |

## 目录结构

```
src/
├── index.ts              # Express 入口
├── db/
│   ├── schema.ts         # Drizzle 表定义
│   ├── index.ts          # DB 连接
│   └── seed.ts           # 种子数据
├── middleware/
│   └── auth.ts           # requireAuth / requireAdmin
├── routes/
│   ├── auth.ts           # 登录/退出
│   ├── pages.ts          # 页面路由
│   ├── courses.ts        # 学生端：课程列表、抢课、退课
│   ├── selections.ts     # 学生端：我的选课
│   ├── admin-courses.ts  # 管理端：课程管理
│   ├── admin-access.ts   # 管理端：access 批次管理
│   └── admin-users.ts    # 管理端：用户管理
├── views/
│   ├── layout.ejs        # 公共布局
│   ├── login.ejs         # 登录页
│   ├── courses.ejs       # 课程列表
│   ├── _course-card.ejs  # 课程卡片组件
│   ├── selections.ejs    # 我的选课
│   ├── admin-courses.ejs # 课程管理
│   ├── admin-access.ejs  # access 管理
│   └── admin-users.ejs   # 用户管理
├── types/
│   └── express.d.ts      # Session 类型扩展
└── lib/
    └── session-store.ts  # 自定义 Session Store
test/
├── integration.ts        # 全流程集成测试
└── concurrent.ts         # 并发安全测试
```

## 核心功能

### 学生端
- 查看课程列表，显示剩余名额和倒计时
- open_time 到达后点击"抢课"按钮（HTMX 局部更新）
- 查看已选课程，支持退课
- 抢课使用事务 + 行锁防超卖

### 管理端
- 课程 CRUD + 重置名额
- 设置全局截止时间
- 管理 access 批次（提前开放指定学生抢课）
- 用户管理

### opentime 优先级
1. 查 `access` + `access_users` 是否有该生的提前批记录 → 有则用 `access.open_time`
2. 否则用 `courses.open_time`

## 抢课并发策略

- SQLite WAL 模式：读不阻塞写
- 抢课走事务 + `FOR UPDATE` 行锁
- `selections` 表 `UNIQUE(user_id, course_id)` 防重复
- 50 人同时抢同一门课排队执行，无超卖

## 可用脚本

```bash
npm run dev          # 开发模式（热重载）
npm start            # 生产模式
npm run db:push      # 推送 schema 到 SQLite
npm run db:seed      # 写入种子数据
npm run db:init      # db:push + db:seed
npm run typecheck    # TypeScript 类型检查

# 测试
npx tsx test/integration.ts   # 全流程集成测试
npx tsx test/concurrent.ts    # 并发安全测试
```

## 部署

```bash
npm run db:init
npm start
```

端口 8080，前面套 Nginx/Caddy 反代 + SSL。
