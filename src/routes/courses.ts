import { Router, Request, Response } from "express";
import { eq, and } from "drizzle-orm";
import { db, rawDb } from "../db/index";
import { courses, access, accessUsers, selections, config } from "../db/schema";
import { requireAuth } from "../middleware/auth";
import { nowLocal } from "../utils/time";

const router = Router();

function getOpenTimeForUser(userId: number, courseId: number): string {
  const record = db
    .select({ openTime: access.openTime })
    .from(access)
    .innerJoin(accessUsers, eq(access.id, accessUsers.accessId))
    .where(and(eq(access.courseId, courseId), eq(accessUsers.userId, userId)))
    .get();

  if (record) return record.openTime;

  const course = db.select({ openTime: courses.openTime }).from(courses).where(eq(courses.id, courseId)).get();
  return course!.openTime;
}

router.get("/courses", requireAuth, (req: Request, res: Response) => {
  if (req.session.isAdmin) return res.redirect("/admin/courses");

  const userId = req.session.userId!;
  const now = nowLocal();

  const endTimeRow = db.select({ value: config.value }).from(config).where(eq(config.key, "end_time")).get();
  const endTime = endTimeRow?.value || now;

  const allCourses = db.select().from(courses).all();

  const selectedRows = db
    .select({ courseId: selections.courseId })
    .from(selections)
    .where(eq(selections.userId, userId))
    .all();
  const selectedIds = new Set(selectedRows.map((r) => r.courseId));

  const courseList = allCourses.map((c) => {
    const opentime = getOpenTimeForUser(userId, c.id);
    const isSelected = selectedIds.has(c.id);

    let state = "open";
    if (isSelected) {
      state = "selected";
    } else if (now >= endTime) {
      state = "closed";
    } else if (c.availableSeats <= 0) {
      state = "full";
    } else if (now < opentime) {
      state = "waiting";
    }

    return { ...c, opentime, state };
  });

  res.render("courses", { courses: courseList, now, endTime });
});

router.post("/api/courses/:id/select", requireAuth, (req: Request, res: Response) => {
  if (req.session.isAdmin) return res.status(403).send("管理员不能选课");

  const userId = req.session.userId!;
  const courseId = Number(req.params.id);
  const now = nowLocal();

  try {
    db.transaction((tx) => {
      const course = tx.select().from(courses).where(eq(courses.id, courseId)).get();
      if (!course) throw new Error("课程不存在");

      const opentime = getOpenTimeForUser(userId, courseId);

      const endTimeRow = tx.select({ value: config.value }).from(config).where(eq(config.key, "end_time")).get();
      const endTime = endTimeRow?.value;

      if (now < opentime) throw new Error("尚未到开放时间");
      if (endTime && now >= endTime) throw new Error("选课已截止");
      if (course.availableSeats <= 0) throw new Error("没有剩余名额");

      const existing = tx
        .select()
        .from(selections)
        .where(and(eq(selections.userId, userId), eq(selections.courseId, courseId)))
        .get();
      if (existing) throw new Error("已选过该课程");

      tx.update(courses)
        .set({ availableSeats: course.availableSeats - 1 })
        .where(eq(courses.id, courseId))
        .run();

      tx.insert(selections)
        .values({ userId, courseId, createdAt: now })
        .run();
    });

    const course = db.select().from(courses).where(eq(courses.id, courseId)).get()!;
    const opentime = getOpenTimeForUser(userId, courseId);

    const c = {
      ...course,
      opentime,
      state: "selected",
    };

    res.render("_course-card", { c, layout: false });
  } catch (e: any) {
    res.status(400).send(e.message);
  }
});

router.post("/api/courses/:id/drop", requireAuth, (req: Request, res: Response) => {
  if (req.session.isAdmin) return res.status(403).send("管理员不能退课");

  const userId = req.session.userId!;
  const courseId = Number(req.params.id);
  const now = nowLocal();

  try {
    db.transaction((tx) => {
      const sel = tx
        .select()
        .from(selections)
        .where(and(eq(selections.userId, userId), eq(selections.courseId, courseId)))
        .get();
      if (!sel) throw new Error("未选过该课程");

      tx.delete(selections)
        .where(eq(selections.id, sel.id))
        .run();

      const course = tx.select().from(courses).where(eq(courses.id, courseId)).get()!;
      tx.update(courses)
        .set({ availableSeats: course.availableSeats + 1 })
        .where(eq(courses.id, courseId))
        .run();
    });

    const course = db.select().from(courses).where(eq(courses.id, courseId)).get()!;
    const opentime = getOpenTimeForUser(userId, courseId);
    const endTimeRow = db.select({ value: config.value }).from(config).where(eq(config.key, "end_time")).get();
    const endTime = endTimeRow?.value || "";
    const sel = db
      .select()
      .from(selections)
      .where(and(eq(selections.userId, userId), eq(selections.courseId, courseId)))
      .get();

    let state = "open";
    if (now >= endTime) {
      state = "closed";
    } else if (now < opentime) {
      state = "waiting";
    } else if (course.availableSeats <= 0) {
      state = "full";
    }

    const c = { ...course, opentime, state };

    res.render("_course-card", { c, layout: false });
  } catch (e: any) {
    res.status(400).send(e.message);
  }
});

export default router;
