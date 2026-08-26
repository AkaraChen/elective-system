import { Router, Request, Response } from "express";
import { eq, sql, inArray, count } from "drizzle-orm";
import { db } from "../db/index";
import { courses, access, accessUsers, selections, config } from "../db/schema";
import { requireAdmin } from "../middleware/auth";
import {
  toLocalISOShort,
  nowLocal,
  isValidLocalDateTime,
  normalizeStartOfDay,
  normalizeEndOfDay,
} from "../utils/time";
import { parseRouteId } from "../utils/parse-id";
import { parseAllowedGrades, serializeAllowedGrades } from "../utils/grade";
import { readEndTime, readStartTime } from "../utils/app-config";
import { removeIneligibleSelections } from "../services/course-grade";

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

const ALLOWED_CONFIG_KEYS = ["end_time", "start_time", "site_title", "max_selections"];

function parseAllowedGradesInput(raw: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
  if (raw == null || String(raw).trim() === "") return { ok: true, value: null };
  const grades = parseAllowedGrades(String(raw));
  if (!grades) return { ok: false, error: "允许年级格式不正确，请填写4位年级标识，多个年级用逗号分隔，例如 2024,2026" };
  return { ok: true, value: serializeAllowedGrades(grades) };
}

class CourseCapacityError extends Error {}

router.get("/admin/courses", requireAdmin, (_req: Request, res: Response) => {
  const endTime = readEndTime(db);
  const startTime = readStartTime(db);
  const siteTitleRow = db.select({ value: config.value }).from(config).where(eq(config.key, "site_title")).get();
  const siteTitle = siteTitleRow?.value || "选课系统";
  const maxSelectionsRow = db.select({ value: config.value }).from(config).where(eq(config.key, "max_selections")).get();
  const maxSelections = maxSelectionsRow?.value || "1";
  const defaultOpenTime = getDefaultOpenTime();
  const minEndDate = startTime.substring(0, 10);

  const courseRows = db.all(
    sql`SELECT c.id, c.name, c.teacher, c.description,
        c.course_time as courseTime, c.location,
        c.total_seats as totalSeats, c.available_seats as availableSeats,
        c.open_time as openTime,
        c.allowed_grades as allowedGrades,
        COALESCE(sc.cnt, 0) as selected_count
        FROM courses c
        LEFT JOIN (SELECT course_id, count(*) as cnt FROM selections GROUP BY course_id) sc
        ON c.id = sc.course_id
        ORDER BY c.id`
  ) as any[];

  res.render("admin-courses", {
    title: "课程管理",
    courses: courseRows,
    endTime,
    startTime,
    siteTitle,
    maxSelections,
    defaultOpenTime,
    minEndDate,
  });
});

router.post("/api/admin/courses", requireAdmin, (req: Request, res: Response) => {
  const { name, teacher, description, courseTime, location, openTime } = req.body;
  const totalSeats = Number(req.body.totalSeats);

  const errors: string[] = [];
  if (!name || !name.trim()) errors.push("课程名称不能为空");
  if (!teacher || !teacher.trim()) errors.push("授课教师不能为空");
  if (!Number.isInteger(totalSeats) || totalSeats < 1) errors.push("总名额必须为大于0的整数");
  if (!openTime || !isValidLocalDateTime(openTime)) errors.push("开放时间格式不正确");
  let allowedGrades: string | null = null;
  const allowed = parseAllowedGradesInput(req.body.allowedGrades);
  if (!allowed.ok) errors.push(allowed.error);
  else allowedGrades = allowed.value;

  if (errors.length > 0) {
    return res.status(400).send(errors.join("；"));
  }

  db.insert(courses).values({
    name: name.trim(),
    teacher: teacher.trim(),
    description: description || null,
    courseTime: courseTime || null,
    location: location || null,
    totalSeats,
    availableSeats: totalSeats,
    openTime: normalizeStartOfDay(openTime) || nowLocal(),
    allowedGrades,
  }).run();

  res.redirect("/admin/courses");
});

router.put("/api/admin/courses/:id", requireAdmin, (req: Request, res: Response) => {
  const courseId = parseRouteId(req.params.id);
  if (courseId === null) return res.status(400).send("无效的课程ID");
  const { name, teacher, description, courseTime, location, totalSeats, openTime, resetSeats, allowedGrades } = req.body;

  const existing = db.select().from(courses).where(eq(courses.id, courseId)).get();
  if (!existing) return res.status(404).send("课程不存在");

  const updateData: any = {};

  if (name !== undefined) {
    if (!String(name).trim()) return res.status(400).send("课程名称不能为空");
    updateData.name = String(name).trim();
  }
  if (teacher !== undefined) {
    if (!String(teacher).trim()) return res.status(400).send("授课教师不能为空");
    updateData.teacher = String(teacher).trim();
  }
  if (description !== undefined) updateData.description = description || null;
  if (courseTime !== undefined) updateData.courseTime = courseTime || null;
  if (location !== undefined) updateData.location = location || null;
  if (openTime !== undefined) {
    if (openTime && !isValidLocalDateTime(openTime)) {
      return res.status(400).send("开放时间格式不正确");
    }
    updateData.openTime = openTime ? normalizeStartOfDay(openTime) : openTime;
  }
  if (allowedGrades !== undefined) {
    const allowed = parseAllowedGradesInput(allowedGrades);
    if (!allowed.ok) return res.status(400).send(allowed.error);
    updateData.allowedGrades = allowed.value;
  }
  let parsedTotalSeats: number | undefined;
  if (totalSeats !== undefined) {
    parsedTotalSeats = Number(totalSeats);
    if (!Number.isInteger(parsedTotalSeats) || parsedTotalSeats < 1) {
      return res.status(400).send("总名额必须为大于0的整数");
    }
    updateData.totalSeats = parsedTotalSeats;
  }

  const shouldResetSeats = resetSeats === "true" || resetSeats === "1";
  let removedCount = 0;

  if (Object.keys(updateData).length > 0 || shouldResetSeats) {
    try {
      db.transaction((tx) => {
        let selectedCount = tx
          .select({ count: count() })
          .from(selections)
          .where(eq(selections.courseId, courseId))
          .get()?.count ?? 0;

        if (allowedGrades !== undefined) {
          const reconciled = removeIneligibleSelections(tx, courseId, updateData.allowedGrades);
          removedCount = reconciled.removedCount;
          selectedCount = reconciled.selectedCount;
        }

        const effectiveTotalSeats = parsedTotalSeats ?? existing.totalSeats;
        if (effectiveTotalSeats < selectedCount) {
          throw new CourseCapacityError(`总名额不能小于已选人数（${selectedCount}）`);
        }

        if (parsedTotalSeats !== undefined || shouldResetSeats || removedCount > 0) {
          updateData.availableSeats = effectiveTotalSeats - selectedCount;
        }

        tx.update(courses).set(updateData).where(eq(courses.id, courseId)).run();
      });
    } catch (error) {
      if (error instanceof CourseCapacityError) {
        return res.status(400).send(error.message);
      }
      throw error;
    }
  }

  if (removedCount > 0) res.set("X-Removed-Selections", String(removedCount));
  res.redirect("/admin/courses");
});

router.delete("/api/admin/courses/:id", requireAdmin, (req: Request, res: Response) => {
  const courseId = parseRouteId(req.params.id);
  if (courseId === null) return res.status(400).send("无效的课程ID");

  const course = db.select().from(courses).where(eq(courses.id, courseId)).get();
  if (!course) return res.status(404).send("课程不存在");

  db.transaction((tx) => {
    const accessIds = tx.select({ id: access.id }).from(access).where(eq(access.courseId, courseId)).all();
    if (accessIds.length > 0) {
      tx.delete(accessUsers).where(
        inArray(accessUsers.accessId, accessIds.map(a => a.id))
      ).run();
    }
    tx.delete(access).where(eq(access.courseId, courseId)).run();
    tx.delete(selections).where(eq(selections.courseId, courseId)).run();
    tx.delete(courses).where(eq(courses.id, courseId)).run();
  });

  res.status(200).send("OK");
});

router.put("/api/admin/config", requireAdmin, (req: Request, res: Response) => {
  const { key, value } = req.body;

  if (!ALLOWED_CONFIG_KEYS.includes(key)) {
    return res.status(400).send("不可修改的配置项");
  }

  if ((key === "start_time" || key === "end_time") && !value) {
    return res.status(400).send("开始时间和截止时间不能为空");
  }

  if (key === "end_time" && value && !isValidLocalDateTime(value)) {
    return res.status(400).send("截止时间格式不正确");
  }
  if (key === "start_time" && value && !isValidLocalDateTime(value)) {
    return res.status(400).send("开始时间格式不正确");
  }
  if (key === "max_selections" && (!/^\d+$/.test(String(value)) || Number(value) < 1)) {
    return res.status(400).send("最大选课数必须为正整数");
  }
  if (key === "site_title" && !String(value || "").trim()) {
    return res.status(400).send("显示标题不能为空");
  }

  let stored = value || "";
  if (key === "end_time" && stored) stored = normalizeEndOfDay(stored);
  if (key === "start_time" && stored) stored = normalizeStartOfDay(stored);
  if (key === "site_title") stored = stored.trim();

  if (key === "start_time" && stored >= readEndTime(db)) {
    return res.status(400).send("开始时间必须早于截止时间");
  }
  if (key === "end_time" && stored <= readStartTime(db)) {
    return res.status(400).send("截止时间必须晚于开始时间");
  }

  db.insert(config).values({ key, value: stored })
    .onConflictDoUpdate({ target: config.key, set: { value: stored } })
    .run();

  res.redirect("/admin/courses");
});

export default router;
