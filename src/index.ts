import express from "express";
import session from "express-session";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import { db } from "./db/index";
import { users, config } from "./db/schema";
import { eq } from "drizzle-orm";
import { BetterSqlite3Store } from "./lib/session-store";
import pagesRouter from "./routes/pages";
import authRouter from "./routes/auth";
import coursesRouter from "./routes/courses";
import selectionsRouter from "./routes/selections";
import adminCoursesRouter from "./routes/admin-courses";
import adminAccessRouter from "./routes/admin-access";
import adminUsersRouter from "./routes/admin-users";
import adminClassRouter from "./routes/admin-class";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const sessionDb = new Database("data/sessions.db");
sessionDb.pragma("journal_mode = WAL");

app.use(session({
  store: new BetterSqlite3Store({ db: sessionDb }),
  secret: "elective-system-secret-change-in-production",
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 },
}));

app.use(express.static(path.join(path.dirname(__dirname), "public")));

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use((req, _res, next) => {
  _res.locals.currentPath = req.path;
  if (req.session.userId) {
    const user = db.select().from(users).where(eq(users.id, req.session.userId)).get();
    _res.locals.user = user || null;
  } else {
    _res.locals.user = null;
  }
  const siteTitleRow = db.select({ value: config.value }).from(config).where(eq(config.key, "site_title")).get();
  _res.locals.siteTitle = siteTitleRow?.value || "选课系统";
  next();
});

app.use((req, res, next) => {
  const _render = res.render.bind(res);
  (res as any).render = function (view: string, options: any = {}, callback?: any) {
    if (view === "login" || view === "layout" || options.layout === false) {
      return _render(view, { ...options, user: options.user || res.locals.user }, callback);
    }
    const merged = { ...options, user: options.user || res.locals.user };
    _render(view, merged, (err: any, body: string) => {
      if (err) return callback ? callback(err) : next(err);
      _render("layout", { ...merged, body }, callback);
    });
  };
  next();
});

app.use("/", pagesRouter);
app.use("/", authRouter);
app.use("/", coursesRouter);
app.use("/", selectionsRouter);
app.use("/", adminCoursesRouter);
app.use("/", adminAccessRouter);
app.use("/", adminUsersRouter);
app.use("/", adminClassRouter);

app.listen(8080, () => {
  console.log("Server running on http://localhost:8080");
});

export default app;
