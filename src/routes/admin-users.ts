import { Router, Request, Response } from "express";
import { eq, and } from "drizzle-orm";
import bcryptjs from "bcryptjs";
import { db } from "../db/index";
import { users, selections, accessUsers } from "../db/schema";
import { requireAdmin } from "../middleware/auth";

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
  const userId = parseInt(req.params.id as string);
  const { username, password, isAdmin } = req.body;

  const existing = db.select().from(users).where(eq(users.id, userId)).get();
  if (!existing) return res.status(404).send("用户不存在");

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
  const userId = parseInt(req.params.id as string);

  const existing = db.select().from(users).where(eq(users.id, userId)).get();
  if (!existing) return res.status(404).send("用户不存在");

  db.delete(selections).where(eq(selections.userId, userId)).run();
  db.delete(accessUsers).where(eq(accessUsers.userId, userId)).run();
  db.delete(users).where(eq(users.id, userId)).run();

  res.status(200).send("OK");
});

export default router;
