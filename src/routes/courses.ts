import { Router, Request, Response } from "express";
import { eq, and, count } from "drizzle-orm";
import { db } from "../db/index";
import { courses, access, accessUsers, selections, users } from "../db/schema";
import { requireAuth } from "../middleware/auth";
import { asEndInstant, nowLocal } from "../utils/time";
import { parseRouteId } from "../utils/parse-id";
import { isGradeAllowed, studentCohort } from "../utils/grade";
import { effectiveOpenTime, resolveCourseState } from "../utils/course-state";
import { readConfig, readEndTime, readStartTime } from "../utils/app-config";

const router = Router();

function getOpenTimeForUser(client: any, userId: number, courseId: number): string {
  const record = client
    .select({ openTime: access.openTime })
    .from(access)
    .innerJoin(accessUsers, eq(access.id, accessUsers.accessId))
    .where(and(eq(access.courseId, courseId), eq(accessUsers.userId, userId)))
    .get();

  if (record) return record.openTime;

  const course = client.select({ openTime: courses.openTime }).from(courses).where(eq(courses.id, courseId)).get();
  return course!.openTime;
}

const DEFAULT_MAX_SELECTIONS = 3;

function getMaxSelections(): number {
  const v = parseInt(readConfig(db, "max_selections") || "");
  return (!isNaN(v) && v > 0) ? v : DEFAULT_MAX_SELECTIONS;
}

router.get("/courses", requireAuth, (req: Request, res: Response) => {
  if (req.session.isAdmin) return res.redirect("/admin/courses");

  const userId = req.session.userId!;
  const now = nowLocal();
  const user = db.select().from(users).where(eq(users.id, userId)).get();
  const grade = studentCohort(user?.year);
  const startTime = readStartTime(db);
  const endTime = readEndTime(db) || now;

  const allCourses = db.select().from(courses).all();

  const selectedRows = db
    .select({ courseId: selections.courseId })
    .from(selections)
    .where(eq(selections.userId, userId))
    .all();
  const selectedIds = new Set(selectedRows.map((r) => r.courseId));

  const courseList = allCourses
    .filter((c) => selectedIds.has(c.id) || isGradeAllowed(grade, c.allowedGrade))
    .map((c) => {
      const courseOpen = getOpenTimeForUser(db, userId, c.id);
      const opentime = effectiveOpenTime(courseOpen, startTime);
      const isSelected = selectedIds.has(c.id);
      const state = resolveCourseState({
        now,
        openTime: courseOpen,
        startTime,
        endTime,
        selected: isSelected,
        availableSeats: c.availableSeats,
      });
      return { ...c, opentime, state, endtime: endTime };
    });

  res.render("courses", { courses: courseList, now, endTime });
});

function isInternalError(msg: string): boolean {
  return /SQLITE|stack|undefined|null|cannot|syntax|ReferenceError|TypeError/i.test(msg);
}

router.post("/api/courses/:id/select", requireAuth, (req: Request, res: Response) => {
  if (req.session.isAdmin) return res.status(403).send("管理员不能选课");

  const userId = req.session.userId!;
  const courseId = parseRouteId(req.params.id);
  if (courseId === null) return res.status(400).send("无效的课程ID");
  const now = nowLocal();

  const maxSelections = getMaxSelections();

  try {
    db.transaction((tx) => {
      const course = tx.select().from(courses).where(eq(courses.id, courseId)).get();
      if (!course) throw new Error("课程不存在");

      const currentCount = tx
        .select({ count: count() })
        .from(selections)
        .where(eq(selections.userId, userId))
        .get();
      if (currentCount && currentCount.count >= maxSelections) {
        throw new Error(`最多只能选 ${maxSelections} 门课`);
      }

      const user = tx.select().from(users).where(eq(users.id, userId)).get();
      const grade = studentCohort(user?.year);
      if (!isGradeAllowed(grade, course.allowedGrade)) {
        throw new Error("当前年级不可选择该课程");
      }

      const opentime = getOpenTimeForUser(tx, userId, courseId);
      const startTime = readStartTime(tx);
      const endTime = readEndTime(tx);
      const effectiveOpen = effectiveOpenTime(opentime, startTime);

      if (now < effectiveOpen) throw new Error("尚未到开放时间");
      if (endTime && now >= asEndInstant(endTime)) throw new Error("选课已截止");
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
    const courseOpen = getOpenTimeForUser(db, userId, courseId);
    const startTime = readStartTime(db);
    const endTimeStr = readEndTime(db) || "";

    const c = {
      ...course,
      opentime: effectiveOpenTime(courseOpen, startTime),
      state: "selected",
      endtime: endTimeStr,
    };

    res.render("_course-card", { c, layout: false });
  } catch (e: any) {
    const msg = e.message || "";
    res.status(400).send(isInternalError(msg) ? "操作失败，请稍后重试" : msg);
  }
});

router.post("/api/courses/:id/drop", requireAuth, (req: Request, res: Response) => {
  if (req.session.isAdmin) return res.status(403).send("管理员不能退课");

  const userId = req.session.userId!;
  const courseId = parseRouteId(req.params.id);
  if (courseId === null) return res.status(400).send("无效的课程ID");
  const now = nowLocal();

  try {
    db.transaction((tx) => {
      const endTime = readEndTime(tx);
      if (endTime && now >= asEndInstant(endTime)) throw new Error("选课已截止，无法退课");

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
    const courseOpen = getOpenTimeForUser(db, userId, courseId);
    const startTime = readStartTime(db);
    const endTime = readEndTime(db) || "";
    const opentime = effectiveOpenTime(courseOpen, startTime);
    const state = resolveCourseState({
      now,
      openTime: courseOpen,
      startTime,
      endTime,
      selected: false,
      availableSeats: course.availableSeats,
    });

    const c = { ...course, opentime, state, endtime: endTime };

    res.render("_course-card", { c, layout: false });
  } catch (e: any) {
    const msg = e.message || "";
    res.status(400).send(isInternalError(msg) ? "操作失败，请稍后重试" : msg);
  }
});

export default router;
