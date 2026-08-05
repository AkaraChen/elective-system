import { Router, Request, Response } from "express";
import { eq, sql } from "drizzle-orm";
import { db } from "../db/index";
import { courses, access, accessUsers, selections, config } from "../db/schema";
import { requireAdmin } from "../middleware/auth";
import { toLocalISOShort, nowLocal } from "../utils/time";

const router = Router();

function getDefaultOpenTime(): string {
  const now = new Date();
  const year = now.getFullYear();
  const mar1This = new Date(year, 2, 1);
  const sep1This = new Date(year, 8, 1);
  const mar1 = mar1This > now ? mar1This : new Date(year + 1, 2, 1);
  const sep1 = sep1This > now ? sep1This : new Date(year + 1, 8, 1);
  const closer = mar1.getTime() - now.getTime() < sep1.getTime() - now.getTime() ? mar1 : sep1;
  return toLocalISOShort(closer);
}

router.get("/admin/courses", requireAdmin, (_req: Request, res: Response) => {
  const endTimeRow = db.select({ value: config.value }).from(config).where(eq(config.key, "end_time")).get();
  const endTime = endTimeRow?.value || "";
  const siteTitleRow = db.select({ value: config.value }).from(config).where(eq(config.key, "site_title")).get();
  const siteTitle = siteTitleRow?.value || "选课系统";
  const defaultOpenTime = getDefaultOpenTime();
  const minEndDate = defaultOpenTime.substring(0, 10);

  const courseRows = db.all(
    sql`SELECT c.id, c.name, c.teacher, c.description,
        c.course_time as courseTime, c.location,
        c.total_seats as totalSeats, c.available_seats as availableSeats,
        c.open_time as openTime,
        COALESCE(sc.cnt, 0) as selected_count
        FROM courses c
        LEFT JOIN (SELECT course_id, count(*) as cnt FROM selections GROUP BY course_id) sc
        ON c.id = sc.course_id
        ORDER BY c.id`
  ) as any[];

  res.render("admin-courses", { title: "课程管理", courses: courseRows, endTime, siteTitle, defaultOpenTime, minEndDate });
});

router.post("/api/admin/courses", requireAdmin, (req: Request, res: Response) => {
  const { name, teacher, description, courseTime, location, totalSeats, openTime } = req.body;
  const seats = parseInt(totalSeats) || 0;

  db.insert(courses).values({
    name: name || "",
    teacher: teacher || "",
    description: description || null,
    courseTime: courseTime || null,
    location: location || null,
    totalSeats: seats,
    availableSeats: seats,
    openTime: openTime || nowLocal(),
  }).run();

  res.redirect("/admin/courses");
});

router.put("/api/admin/courses/:id", requireAdmin, (req: Request, res: Response) => {
  const courseId = parseInt(req.params.id as string);
  const { name, teacher, description, courseTime, location, totalSeats, openTime, resetSeats } = req.body;

  const existing = db.select().from(courses).where(eq(courses.id, courseId)).get();
  if (!existing) return res.status(404).send("课程不存在");

  const updateData: any = {};

  if (name !== undefined) updateData.name = name;
  if (teacher !== undefined) updateData.teacher = teacher;
  if (description !== undefined) updateData.description = description || null;
  if (courseTime !== undefined) updateData.courseTime = courseTime || null;
  if (location !== undefined) updateData.location = location || null;
  if (openTime !== undefined) updateData.openTime = openTime;
  if (totalSeats !== undefined) {
    const seats = parseInt(totalSeats);
    if (!isNaN(seats) && seats >= 0) {
      updateData.totalSeats = seats;
    }
  }

  if (resetSeats === "true" || resetSeats === "1") {
    updateData.availableSeats = totalSeats !== undefined ? parseInt(totalSeats) : existing.totalSeats;
  }

  if (Object.keys(updateData).length > 0) {
    db.update(courses).set(updateData).where(eq(courses.id, courseId)).run();
  }

  res.redirect("/admin/courses");
});

router.delete("/api/admin/courses/:id", requireAdmin, (req: Request, res: Response) => {
  const courseId = parseInt(req.params.id as string);

  const existing = db.select().from(courses).where(eq(courses.id, courseId)).get();
  if (!existing) return res.status(404).send("课程不存在");

  db.run(sql`DELETE FROM access_users WHERE access_id IN (SELECT id FROM access WHERE course_id = ${courseId})`);
  db.run(sql`DELETE FROM access WHERE course_id = ${courseId}`);
  db.delete(selections).where(eq(selections.courseId, courseId)).run();
  db.delete(courses).where(eq(courses.id, courseId)).run();

  res.status(200).send("OK");
});

router.put("/api/admin/config", requireAdmin, (req: Request, res: Response) => {
  const { key, value } = req.body;

  db.insert(config).values({ key: key || "end_time", value: value || "" })
    .onConflictDoUpdate({ target: config.key, set: { value: value || "" } })
    .run();

  res.redirect("/admin/courses");
});

export default router;
