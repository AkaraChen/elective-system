import { Router, Request, Response } from "express";
import { eq, sql } from "drizzle-orm";
import { db } from "../db/index";
import { access, accessUsers, courses, users } from "../db/schema";
import { requireAdmin } from "../middleware/auth";
import { nowLocal } from "../utils/time";

const router = Router();

router.get("/admin/access", requireAdmin, (_req: Request, res: Response) => {
  const accessRows = db.all(
    sql`SELECT a.*, c.name as course_name,
        (SELECT count(*) FROM access_users au WHERE au.access_id = a.id) as student_count
        FROM access a
        JOIN courses c ON a.course_id = c.id
        ORDER BY a.id`
  ) as any[];

  const allCourses = db.select().from(courses).all();
  const allStudents = db.select().from(users).where(eq(users.isAdmin, 0)).all();

  const auRows = db
    .select({
      accessId: accessUsers.accessId,
      userId: accessUsers.userId,
      username: users.username,
    })
    .from(accessUsers)
    .innerJoin(users, eq(accessUsers.userId, users.id))
    .all();

  const accessStudents: Record<number, { userId: number; username: string }[]> = {};
  auRows.forEach((r) => {
    if (!accessStudents[r.accessId]) accessStudents[r.accessId] = [];
    accessStudents[r.accessId].push({ userId: r.userId, username: r.username });
  });

  res.render("admin-access", {
    title: "抢课批次管理",
    accessRows,
    allCourses,
    allStudents,
    accessStudents,
  });
});

router.post("/api/admin/access", requireAdmin, (req: Request, res: Response) => {
  const { course_id, open_time, user_ids } = req.body;

  const inserted = db.insert(access).values({
    courseId: parseInt(course_id),
    openTime: open_time || nowLocal(),
  }).returning().get();

  if (!inserted) return res.redirect("/admin/access");

  const ids: number[] = Array.isArray(user_ids)
    ? user_ids.map((id: string) => parseInt(id)).filter((id: number) => !isNaN(id))
    : user_ids ? [parseInt(user_ids)] : [];

  if (ids.length > 0) {
    db.insert(accessUsers).values(
      ids.map((userId: number) => ({
        accessId: inserted.id,
        userId,
      }))
    ).run();
  }

  res.redirect("/admin/access");
});

router.put("/api/admin/access/:id", requireAdmin, (req: Request, res: Response) => {
  const accessId = parseInt(req.params.id as string);
  const { open_time, user_ids } = req.body;

  const existing = db.select().from(access).where(eq(access.id, accessId)).get();
  if (!existing) return res.status(404).send("Access组不存在");

  if (open_time) {
    db.update(access).set({ openTime: open_time }).where(eq(access.id, accessId)).run();
  }

  db.delete(accessUsers).where(eq(accessUsers.accessId, accessId)).run();

  const ids: number[] = Array.isArray(user_ids)
    ? user_ids.map((id: string) => parseInt(id)).filter((id: number) => !isNaN(id))
    : user_ids ? [parseInt(user_ids)] : [];

  if (ids.length > 0) {
    db.insert(accessUsers).values(
      ids.map((userId: number) => ({
        accessId,
        userId,
      }))
    ).run();
  }

  res.redirect("/admin/access");
});

router.delete("/api/admin/access/:id", requireAdmin, (req: Request, res: Response) => {
  const accessId = parseInt(req.params.id as string);

  db.delete(accessUsers).where(eq(accessUsers.accessId, accessId)).run();
  db.delete(access).where(eq(access.id, accessId)).run();

  res.status(200).send("OK");
});

export default router;
