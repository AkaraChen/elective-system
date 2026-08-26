import { eq, inArray } from "drizzle-orm";
import { courses, selections, users } from "../db/schema";
import { isGradeAllowed, studentGrade } from "../utils/grade";

export function removeIneligibleSelections(
  client: any,
  courseId: number,
  allowedGrades: string | null,
): { removedCount: number; selectedCount: number } {
  const selected = client
    .select({ selectionId: selections.id, grade: users.grade })
    .from(selections)
    .innerJoin(users, eq(selections.userId, users.id))
    .where(eq(selections.courseId, courseId))
    .all() as Array<{ selectionId: number; grade: number | null }>;

  const removedIds = selected
    .filter(({ grade }) => !isGradeAllowed(studentGrade(grade), allowedGrades))
    .map(({ selectionId }) => selectionId);

  if (removedIds.length > 0) {
    client.delete(selections).where(inArray(selections.id, removedIds)).run();
  }

  return {
    removedCount: removedIds.length,
    selectedCount: selected.length - removedIds.length,
  };
}

export function removeUserIneligibleSelections(
  client: any,
  userId: number,
  grade: number | null,
): number {
  const selected = client
    .select({ selectionId: selections.id, courseId: courses.id, allowedGrades: courses.allowedGrades })
    .from(selections)
    .innerJoin(courses, eq(selections.courseId, courses.id))
    .where(eq(selections.userId, userId))
    .all() as Array<{ selectionId: number; courseId: number; allowedGrades: string | null }>;

  const removed = selected.filter(({ allowedGrades }) => !isGradeAllowed(grade, allowedGrades));
  if (removed.length === 0) return 0;

  client.delete(selections).where(inArray(selections.id, removed.map(({ selectionId }) => selectionId))).run();

  for (const courseId of new Set(removed.map((item) => item.courseId))) {
    const course = client.select().from(courses).where(eq(courses.id, courseId)).get();
    if (!course) continue;
    const selectedCount = client
      .select({ id: selections.id })
      .from(selections)
      .where(eq(selections.courseId, courseId))
      .all().length;
    client.update(courses)
      .set({ availableSeats: course.totalSeats - selectedCount })
      .where(eq(courses.id, courseId))
      .run();
  }

  return removed.length;
}
