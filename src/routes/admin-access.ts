import { Router, Request, Response } from "express";
import { eq, and, inArray, sql } from "drizzle-orm";
import { db } from "../db/index";
import { access, accessUsers, courses, users } from "../db/schema";
import { requireAdmin } from "../middleware/auth";
import { nowLocal } from "../utils/time";
import { parseRouteId } from "../utils/parse-id";

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
    title: "优先批次管理",
    accessRows,
    allCourses,
    allStudents,
    accessStudents,
  });
});

router.post("/api/admin/access", requireAdmin, (req: Request, res: Response) => {
  const courseId = parseInt(req.body.course_id);
  const openTime = req.body.open_time;
  const userIds: string[] = (req.body.user_ids || "").toString().split(",").map((s: string) => s.trim()).filter(Boolean);

  if (isNaN(courseId) || courseId < 1) return res.status(400).send("无效的课程ID");
  if (!openTime || isNaN(Date.parse(openTime))) return res.status(400).send("无效的开放时间");
  if (userIds.length === 0) return res.status(400).send("至少选择一个学生");

  const course = db.select().from(courses).where(eq(courses.id, courseId)).get();
  if (!course) return res.status(400).send("课程不存在");

  const uniqueIds = [...new Set(userIds.map(Number).filter(id => !isNaN(id) && id > 0))];
  const validUsers = db.select({ id: users.id }).from(users)
    .where(and(eq(users.isAdmin, 0), inArray(users.id, uniqueIds)))
    .all();
  const validIds = validUsers.map(u => u.id);

  if (validIds.length === 0) return res.status(400).send("没有有效的学生ID");

  db.transaction((tx) => {
    const result = tx.insert(access).values({ courseId, openTime: openTime || nowLocal() }).run();
    if (result.lastInsertRowid && validIds.length > 0) {
      tx.insert(accessUsers).values(
        validIds.map(userId => ({ accessId: Number(result.lastInsertRowid), userId }))
      ).run();
    }
  });

  res.redirect("/admin/access");
});

router.put("/api/admin/access/:id", requireAdmin, (req: Request, res: Response) => {
  const accessId = parseRouteId(req.params.id);
  if (accessId === null) return res.status(400).send("无效的批次ID");
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
  const accessId = parseRouteId(req.params.id);
  if (accessId === null) return res.status(400).send("无效的批次ID");

  db.delete(accessUsers).where(eq(accessUsers.accessId, accessId)).run();
  db.delete(access).where(eq(access.id, accessId)).run();

  res.status(200).send("OK");
});

export default router;
