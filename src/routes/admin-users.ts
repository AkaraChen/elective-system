import { Router, Request, Response } from "express";
import { eq, and, count, ne } from "drizzle-orm";
import bcryptjs from "bcryptjs";
import { db } from "../db/index";
import { users, selections, accessUsers } from "../db/schema";
import { requireAdmin } from "../middleware/auth";
import { parseRouteId } from "../utils/parse-id";

const router = Router();

router.get("/admin/users", requireAdmin, (_req: Request, res: Response) => {
  const admins = db.select().from(users).where(eq(users.isAdmin, 1)).orderBy(users.id).all();

  res.render("admin-users", {
    title: "用户管理",
    admins,
  });
});

router.get("/api/admin/users/search", requireAdmin, (req: Request, res: Response) => {
  const { username } = req.query;
  if (!username || typeof username !== "string" || !username.trim()) {
    return res.send(`<div class="px-6 py-4 text-sm text-gray-500">请输入用户名</div>`);
  }

  const user = db.select().from(users)
    .where(and(eq(users.username, username.trim()), eq(users.isAdmin, 0)))
    .get();

  if (!user) {
    return res.send(`<div class="px-6 py-4 text-sm text-red-500">未找到学生 "${username}"</div>`);
  }

  const u = { ...user, isAdmin: user.isAdmin as unknown as number };
  res.render("_user-row", { u, layout: false });
});

router.post("/api/admin/users", requireAdmin, (req: Request, res: Response) => {
  const { username, password, isAdmin } = req.body;

  if (!username || !password) return res.redirect("/admin/users");

  const existing = db.select().from(users).where(eq(users.username, username)).get();
  if (existing) return res.redirect("/admin/users");

  const hash = bcryptjs.hashSync(password, 10);

  db.insert(users).values({
    username,
    password: hash,
    isAdmin: isAdmin === "1" || isAdmin === 1 ? 1 : 0,
  }).run();

  res.redirect("/admin/users");
});

router.put("/api/admin/users/:id", requireAdmin, (req: Request, res: Response) => {
  const userId = parseRouteId(req.params.id);
  if (userId === null) return res.status(400).send("无效的用户ID");
  const { username, password, isAdmin } = req.body;

  const existing = db.select().from(users).where(eq(users.id, userId)).get();
  if (!existing) return res.status(404).send("用户不存在");

  if (isAdmin !== undefined && isAdmin === "0" && userId === req.session.userId) {
    return res.status(400).send("不能取消自己的管理员权限");
  }

  if (isAdmin !== undefined && (isAdmin === "0" || isAdmin === 0)) {
    const adminCount = db.select({ count: count() }).from(users).where(eq(users.isAdmin, 1)).get()?.count ?? 0;
    if (adminCount <= 1) {
      return res.status(400).send("不能移除最后一个管理员");
    }
  }

  if (username !== undefined && username !== "") {
    const dup = db.select().from(users)
      .where(and(eq(users.username, username), ne(users.id, userId)))
      .get();
    if (dup) {
      return res.status(400).send("用户名已被其他用户使用");
    }
  }

  const updateData: any = {};

  if (username !== undefined && username !== "") {
    updateData.username = username;
  }
  if (isAdmin !== undefined) {
    updateData.isAdmin = isAdmin === "1" || isAdmin === 1 ? 1 : 0;
  }
  if (password !== undefined && password !== "") {
    updateData.password = bcryptjs.hashSync(password, 10);
  }

  if (Object.keys(updateData).length > 0) {
    db.update(users).set(updateData).where(eq(users.id, userId)).run();
  }

  res.redirect("/admin/users");
});

router.delete("/api/admin/users/:id", requireAdmin, (req: Request, res: Response) => {
  const userId = parseRouteId(req.params.id);
  if (userId === null) return res.status(400).send("无效的用户ID");

  if (userId === req.session.userId) {
    return res.status(400).send("不能删除自己的账户");
  }

  const existing = db.select().from(users).where(eq(users.id, userId)).get();
  if (!existing) return res.status(404).send("用户不存在");

  if (existing.isAdmin) {
    const adminCount = db.select({ count: count() }).from(users).where(eq(users.isAdmin, 1)).get()?.count ?? 0;
    if (adminCount <= 1) {
      return res.status(400).send("不能移除最后一个管理员");
    }
  }

  db.transaction((tx) => {
    tx.delete(selections).where(eq(selections.userId, userId)).run();
    tx.delete(accessUsers).where(eq(accessUsers.userId, userId)).run();
    tx.delete(users).where(eq(users.id, userId)).run();
  });

  res.status(200).send("OK");
});

export default router;
