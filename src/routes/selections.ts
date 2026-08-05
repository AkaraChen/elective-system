import { Router, Request, Response } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db/index";
import { selections, courses } from "../db/schema";
import { requireAuth } from "../middleware/auth";

const router = Router();

router.get("/selections", requireAuth, (req: Request, res: Response) => {
  if (req.session.isAdmin) return res.redirect("/admin/courses");

  const userId = req.session.userId!;

  const rows = db
    .select({
      id: selections.id,
      courseId: selections.courseId,
      userId: selections.userId,
      createdAt: selections.createdAt,
      courseName: courses.name,
      teacher: courses.teacher,
      courseTime: courses.courseTime,
      location: courses.location,
    })
    .from(selections)
    .innerJoin(courses, eq(selections.courseId, courses.id))
    .where(eq(selections.userId, userId))
    .all();

  res.render("selections", { title: "我的选课", selections: rows });
});

export default router;
