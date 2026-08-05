import { Router, Request, Response } from "express";
import bcryptjs from "bcryptjs";
import { db } from "../db/index";
import { users } from "../db/schema";
import { eq } from "drizzle-orm";

const router = Router();

router.post("/api/login", (req: Request, res: Response) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.render("login", { error: "请输入用户名和密码", title: "登录" });
  }

  const user = db.select().from(users).where(eq(users.username, username)).get();

  if (!user || !bcryptjs.compareSync(password, user.password)) {
    return res.render("login", { error: "用户名或密码错误", title: "登录" });
  }

  req.session.regenerate((err) => {
    if (err) return res.status(500).send("登录失败");
    req.session.userId = user.id;
    req.session.isAdmin = user.isAdmin;
    req.session.save(() => {
      const redirectTo = user.isAdmin ? "/admin/courses" : "/courses";
      res.redirect(redirectTo);
    });
  });
});

router.post("/api/logout", (req: Request, res: Response) => {
  req.session.destroy(() => {
    res.redirect("/login");
  });
});

export default router;
