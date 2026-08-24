import { eq, inArray } from "drizzle-orm";
import { selections, users } from "../db/schema";
import { isGradeAllowed, studentCohort } from "../utils/grade";

export function removeIneligibleSelections(
  client: any,
  courseId: number,
  allowedGrade: string | null,
): { removedCount: number; selectedCount: number } {
  const selected = client
    .select({ selectionId: selections.id, year: users.year })
    .from(selections)
    .innerJoin(users, eq(selections.userId, users.id))
    .where(eq(selections.courseId, courseId))
    .all() as Array<{ selectionId: number; year: number | null }>;

  const removedIds = selected
    .filter(({ year }) => !isGradeAllowed(studentCohort(year), allowedGrade))
    .map(({ selectionId }) => selectionId);

  if (removedIds.length > 0) {
    client.delete(selections).where(inArray(selections.id, removedIds)).run();
  }

  return {
    removedCount: removedIds.length,
    selectedCount: selected.length - removedIds.length,
  };
}
