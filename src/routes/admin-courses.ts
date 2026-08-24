import { Router, Request, Response } from "express";
import { eq, sql, inArray, count } from "drizzle-orm";
import { db } from "../db/index";
import { courses, access, accessUsers, selections, config } from "../db/schema";
import { requireAdmin } from "../middleware/auth";
import {
  toLocalISOShort,
  nowLocal,
  defaultStartTime,
  isValidLocalDateTime,
  normalizeStartOfDay,
  normalizeEndOfDay,
} from "../utils/time";
import { parseRouteId } from "../utils/parse-id";
import { isGradeOrder, parseAllowedGrades, serializeAllowedGrades } from "../utils/grade";
import { readGradeOrder } from "../utils/app-config";

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

const ALLOWED_CONFIG_KEYS = ["end_time", "start_time", "site_title", "max_selections", "grade_order"];

function parseAllowedGradeInput(raw: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
  if (raw == null || String(raw).trim() === "") return { ok: true, value: null };
  const grades = parseAllowedGrades(String(raw));
  if (!grades) return { ok: false, error: "允许年级格式不正确，请填写正整数，多个年级用逗号分隔，例如 1,3" };
  return { ok: true, value: serializeAllowedGrades(grades) };
}

router.get("/admin/courses", requireAdmin, (_req: Request, res: Response) => {
  const endTimeRow = db.select({ value: config.value }).from(config).where(eq(config.key, "end_time")).get();
  const endTime = endTimeRow?.value || "";
  const startTimeRow = db.select({ value: config.value }).from(config).where(eq(config.key, "start_time")).get();
  const startTime = startTimeRow?.value || defaultStartTime();
  const siteTitleRow = db.select({ value: config.value }).from(config).where(eq(config.key, "site_title")).get();
  const siteTitle = siteTitleRow?.value || "选课系统";
  const maxSelectionsRow = db.select({ value: config.value }).from(config).where(eq(config.key, "max_selections")).get();
  const maxSelections = maxSelectionsRow?.value || "1";
  const gradeOrder = readGradeOrder(db);
  const defaultOpenTime = getDefaultOpenTime();
  const closerMonth = defaultOpenTime.substring(5, 7);
  const closerYear = defaultOpenTime.substring(0, 4);
  const nextOpenDateLabel = `${closerYear}年${closerMonth === "03" ? "3" : "9"}月1日`;
  const minEndDate = defaultOpenTime.substring(0, 10);

  const courseRows = db.all(
    sql`SELECT c.id, c.name, c.teacher, c.description,
        c.course_time as courseTime, c.location,
        c.total_seats as totalSeats, c.available_seats as availableSeats,
        c.open_time as openTime,
        c.allowed_grade as allowedGrade,
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
    gradeOrder,
    nextOpenDateLabel,
    defaultOpenTime,
    minEndDate,
  });
});

router.post("/api/admin/courses", requireAdmin, (req: Request, res: Response) => {
  const { name, teacher, description, courseTime, location, openTime } = req.body;
  const totalSeats = parseInt(req.body.totalSeats);

  const errors: string[] = [];
  if (!name || !name.trim()) errors.push("课程名称不能为空");
  if (!teacher || !teacher.trim()) errors.push("授课教师不能为空");
  if (isNaN(totalSeats) || totalSeats < 1) errors.push("总名额必须为大于0的整数");
  if (!openTime || !isValidLocalDateTime(openTime)) errors.push("开放时间格式不正确");
  let allowedGrade: string | null = null;
  const allowed = parseAllowedGradeInput(req.body.allowedGrade);
  if (!allowed.ok) errors.push(allowed.error);
  else allowedGrade = allowed.value;

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
    allowedGrade,
  }).run();

  res.redirect("/admin/courses");
});

router.put("/api/admin/courses/:id", requireAdmin, (req: Request, res: Response) => {
  const courseId = parseRouteId(req.params.id);
  if (courseId === null) return res.status(400).send("无效的课程ID");
  const { name, teacher, description, courseTime, location, totalSeats, openTime, resetSeats, allowedGrade } = req.body;

  const existing = db.select().from(courses).where(eq(courses.id, courseId)).get();
  if (!existing) return res.status(404).send("课程不存在");

  const updateData: any = {};

  if (name !== undefined) updateData.name = name;
  if (teacher !== undefined) updateData.teacher = teacher;
  if (description !== undefined) updateData.description = description || null;
  if (courseTime !== undefined) updateData.courseTime = courseTime || null;
  if (location !== undefined) updateData.location = location || null;
  if (openTime !== undefined) {
    if (openTime && !isValidLocalDateTime(openTime)) {
      return res.status(400).send("开放时间格式不正确");
    }
    updateData.openTime = openTime ? normalizeStartOfDay(openTime) : openTime;
  }
  if (allowedGrade !== undefined) {
    const allowed = parseAllowedGradeInput(allowedGrade);
    if (!allowed.ok) return res.status(400).send(allowed.error);
    updateData.allowedGrade = allowed.value;
  }
  if (totalSeats !== undefined) {
    const seats = parseInt(totalSeats);
    if (isNaN(seats) || seats < 1) {
      return res.status(400).send("总名额必须为大于0的整数");
    }
    const selectedCount = db
      .select({ count: count() })
      .from(selections)
      .where(eq(selections.courseId, courseId))
      .get()?.count ?? 0;
    if (seats < selectedCount) {
      return res.status(400).send(`总名额不能小于已选人数（${selectedCount}）`);
    }
    updateData.totalSeats = seats;
    updateData.availableSeats = seats - selectedCount;
  }

  if (resetSeats === "true" || resetSeats === "1") {
    const newTotal = totalSeats !== undefined ? parseInt(totalSeats) : existing.totalSeats;
    const selectedCount = db
      .select({ count: count() })
      .from(selections)
      .where(eq(selections.courseId, courseId))
      .get()?.count ?? 0;
    updateData.availableSeats = newTotal - selectedCount;
  }

  if (Object.keys(updateData).length > 0) {
    db.update(courses).set(updateData).where(eq(courses.id, courseId)).run();
  }

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

  if (key === "end_time" && value && !isValidLocalDateTime(value)) {
    return res.status(400).send("截止时间格式不正确");
  }
  if (key === "start_time" && value && !isValidLocalDateTime(value)) {
    return res.status(400).send("开始时间格式不正确");
  }
  if (key === "grade_order" && !isGradeOrder(value || "")) {
    return res.status(400).send("年级顺序只能是入学年份或毕业年份");
  }
  if (key === "max_selections" && (isNaN(parseInt(value)) || parseInt(value) < 1)) {
    return res.status(400).send("最大选课数必须为正整数");
  }

  let stored = value || "";
  if (key === "end_time" && stored) stored = normalizeEndOfDay(stored);
  if (key === "start_time" && stored) stored = normalizeStartOfDay(stored);

  db.insert(config).values({ key, value: stored })
    .onConflictDoUpdate({ target: config.key, set: { value: stored } })
    .run();

  res.redirect("/admin/courses");
});

export default router;
