import { and, asc, eq } from "drizzle-orm";
import { access, accessUsers } from "../db/schema";
import { readConfig } from "../utils/app-config";

const DEFAULT_MAX_SELECTIONS = 3;

export function readMaxSelections(client: any): number {
  const value = Number.parseInt(readConfig(client, "max_selections") || "", 10);
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_MAX_SELECTIONS;
}

export function readBatchOpenTimeForUser(client: any, userId: number, courseId: number): string | null {
  const priority = client
    .select({ openTime: access.openTime })
    .from(access)
    .innerJoin(accessUsers, eq(access.id, accessUsers.accessId))
    .where(and(eq(access.courseId, courseId), eq(accessUsers.userId, userId)))
    .orderBy(asc(access.openTime))
    .limit(1)
    .get();

  return priority ? priority.openTime : null;
}
