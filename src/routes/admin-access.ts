import { Router, Request, Response } from "express";
import { eq, and, inArray, sql } from "drizzle-orm";
import { db } from "../db/index";
import { access, accessUsers, courses, users } from "../db/schema";
import { requireAdmin } from "../middleware/auth";
import { isValidLocalDateTime, normalizeStartOfDay, nowLocal } from "../utils/time";
import { parseRouteId } from "../utils/parse-id";
import { isGradeAllowed } from "../utils/grade";

const router = Router();

router.get("/admin/access", requireAdmin, (_req: Request, res: Response) => {
  const accessRows = db.all(
    sql`SELECT a.*, c.name as course_name, c.allowed_grades as allowedGrades,
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
      nickname: users.nickname,
    })
    .from(accessUsers)
    .innerJoin(users, eq(accessUsers.userId, users.id))
    .all();

  const accessStudents: Record<number, { userId: number; username: string; nickname: string }[]> = {};
  auRows.forEach((r) => {
    if (!accessStudents[r.accessId]) accessStudents[r.accessId] = [];
    accessStudents[r.accessId].push({ userId: r.userId, username: r.username, nickname: r.nickname });
  });

  res.render("admin-access", {
    title: "优先批次管理",
    accessRows,
    allCourses,
    allStudents,
    allStudentsJson: JSON.stringify(allStudents).replace(/</g, "\\u003c"),
    accessStudents,
  });
});

router.post("/api/admin/access", requireAdmin, (req: Request, res: Response) => {
  const courseId = parseInt(req.body.course_id);
  const openTime = req.body.open_time;
  const userIds = parseUserIds(req.body.user_ids);

  if (isNaN(courseId) || courseId < 1) return res.status(400).send("无效的课程ID");
  if (!openTime || !isValidLocalDateTime(openTime)) return res.status(400).send("无效的开放时间");
  if (userIds.length === 0) return res.status(400).send("至少选择一个学生");

  const course = db.select().from(courses).where(eq(courses.id, courseId)).get();
  if (!course) return res.status(400).send("课程不存在");

  const validUsers = db.select({ id: users.id, grade: users.grade }).from(users)
    .where(and(eq(users.isAdmin, 0), inArray(users.id, userIds)))
    .all();
  if (validUsers.length !== userIds.length) return res.status(400).send("批次中包含无效学生ID");
  if (validUsers.some((user) => !isGradeAllowed(user.grade, course.allowedGrades))) {
    return res.status(400).send("批次中包含该课程不允许年级的学生");
  }

  db.transaction((tx) => {
    const result = tx.insert(access).values({ courseId, openTime: normalizeStartOfDay(openTime) || nowLocal() }).run();
    if (result.lastInsertRowid) {
      tx.insert(accessUsers).values(
        userIds.map(userId => ({ accessId: Number(result.lastInsertRowid), userId }))
      ).run();
    }
  });

  res.redirect("/admin/access");
});

router.put("/api/admin/access/:id", requireAdmin, (req: Request, res: Response) => {
  const accessId = parseRouteId(req.params.id);
  if (accessId === null) return res.status(400).send("无效的批次ID");
  const { open_time } = req.body;

  const existing = db.select().from(access).where(eq(access.id, accessId)).get();
  if (!existing) return res.status(404).send("Access组不存在");

  if (!open_time || !isValidLocalDateTime(open_time)) return res.status(400).send("无效的开放时间");
  const userIds = parseUserIds(req.body.user_ids);
  if (userIds.length === 0) return res.status(400).send("至少选择一个学生");

  const course = db.select().from(courses).where(eq(courses.id, existing.courseId)).get();
  if (!course) return res.status(404).send("课程不存在");
  const validUsers = db.select({ id: users.id, grade: users.grade }).from(users)
    .where(and(eq(users.isAdmin, 0), inArray(users.id, userIds)))
    .all();
  if (validUsers.length !== userIds.length) return res.status(400).send("批次中包含无效学生ID");
  if (validUsers.some((user) => !isGradeAllowed(user.grade, course.allowedGrades))) {
    return res.status(400).send("批次中包含该课程不允许年级的学生");
  }

  db.transaction((tx) => {
    tx.update(access)
      .set({ openTime: normalizeStartOfDay(open_time) })
      .where(eq(access.id, accessId))
      .run();
    tx.delete(accessUsers).where(eq(accessUsers.accessId, accessId)).run();
    tx.insert(accessUsers).values(userIds.map((userId) => ({ accessId, userId }))).run();
  });

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

function parseUserIds(raw: unknown): number[] {
  const values = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
  return [...new Set(values
    .flatMap((value) => String(value).split(","))
    .map((value) => /^\d+$/.test(value.trim()) ? Number(value.trim()) : Number.NaN)
    .filter((value) => Number.isInteger(value) && value > 0))];
}
