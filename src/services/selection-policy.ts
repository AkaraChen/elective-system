import { and, asc, eq } from "drizzle-orm";
import { access, accessUsers } from "../db/schema";
import { readConfig } from "../utils/app-config";

const DEFAULT_MAX_SELECTIONS = 3;

export async function readMaxSelections(client: any): Promise<number> {
  const value = Number.parseInt((await readConfig(client, "max_selections")) || "", 10);
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_MAX_SELECTIONS;
}

export async function readBatchOpenTimeForUser(client: any, userId: number, courseId: number): Promise<string | null> {
  const priority = await client
    .select({ openTime: access.openTime })
    .from(access)
    .innerJoin(accessUsers, eq(access.id, accessUsers.accessId))
    .where(and(eq(access.courseId, courseId), eq(accessUsers.userId, userId)))
    .orderBy(asc(access.openTime))
    .limit(1);

  return priority.length > 0 ? priority[0].openTime : null;
}
