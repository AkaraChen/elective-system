import { Router, Request, Response } from "express";
import { eq, and, count, ne } from "drizzle-orm";
import bcryptjs from "bcryptjs";
import { db } from "../db/index";
import { users, selections, accessUsers } from "../db/schema";
import { requireAdmin } from "../middleware/auth";
import { parseRouteId } from "../utils/parse-id";
import { parseAccountInput } from "../services/account";
import { removeUserIneligibleSelections } from "../services/course-grade";

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
    return res.send(`<div class="px-6 py-4 text-sm text-red-500">未找到学生 "${escapeHtml(username.trim())}"</div>`);
  }

  const u = { ...user, isAdmin: user.isAdmin as unknown as number };
  res.render("_user-row", { u, layout: false });
});

router.post("/api/admin/users", requireAdmin, (req: Request, res: Response) => {
  const { password, isAdmin } = req.body;
  if (typeof password !== "string" || password.length === 0 || password.length > 200) {
    return res.status(400).send("密码不能为空且不能超过200个字符");
  }

  const asAdmin = isAdmin === "1" || isAdmin === 1;
  const account = parseAccountInput({
    username: req.body.username,
    nickname: req.body.nickname,
    grade: req.body.grade,
    isAdmin: asAdmin,
  });
  if (!account.ok) return res.status(400).send(account.error);

  const existing = db.select().from(users).where(eq(users.username, account.value.username)).get();
  if (existing) return res.status(400).send("用户名已被其他用户使用");

  const hash = bcryptjs.hashSync(password, 10);

  db.insert(users).values({
    ...account.value,
    password: hash,
    isAdmin: asAdmin ? 1 : 0,
  }).run();

  res.redirect("/admin/users");
});

router.put("/api/admin/users/:id", requireAdmin, (req: Request, res: Response) => {
  const userId = parseRouteId(req.params.id);
  if (userId === null) return res.status(400).send("无效的用户ID");
  const { password, isAdmin } = req.body;

  const existing = db.select().from(users).where(eq(users.id, userId)).get();
  if (!existing) return res.status(404).send("用户不存在");

  if (isAdmin !== undefined && isAdmin === "0" && userId === req.session.userId) {
    return res.status(400).send("不能取消自己的管理员权限");
  }

  if (existing.isAdmin && isAdmin !== undefined && (isAdmin === "0" || isAdmin === 0)) {
    const adminCount = db.select({ count: count() }).from(users).where(eq(users.isAdmin, 1)).get()?.count ?? 0;
    if (adminCount <= 1) {
      return res.status(400).send("不能移除最后一个管理员");
    }
  }

  const asAdmin = isAdmin === undefined
    ? Boolean(existing.isAdmin)
    : isAdmin === "1" || isAdmin === 1;
  const account = parseAccountInput({
    username: req.body.username ?? existing.username,
    nickname: req.body.nickname ?? existing.nickname,
    grade: req.body.grade ?? existing.grade,
    isAdmin: asAdmin,
  });
  if (!account.ok) return res.status(400).send(account.error);

  const dup = db.select().from(users)
    .where(and(eq(users.username, account.value.username), ne(users.id, userId)))
    .get();
  if (dup) {
    return res.status(400).send("用户名已被其他用户使用");
  }

  const updateData: Partial<typeof users.$inferInsert> = {
    ...account.value,
    isAdmin: asAdmin ? 1 : 0,
  };
  if (password !== undefined && password !== "") {
    if (typeof password !== "string" || password.length > 200) {
      return res.status(400).send("密码不能超过200个字符");
    }
    updateData.password = bcryptjs.hashSync(password, 10);
  }

  db.transaction((tx) => {
    tx.update(users).set(updateData).where(eq(users.id, userId)).run();
    removeUserIneligibleSelections(tx, userId, account.value.grade);
  });

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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
