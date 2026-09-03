import { asEndInstant, asStartInstant, earlierInstant } from "./time";

export type CourseState = "waiting" | "open" | "selected" | "full" | "closed";

// Priority batches open earlier than the global start; the effective open
// time is the earlier of the batch time and the global start_time.
export function effectiveOpenTime(openTime: string | null | undefined, startTime?: string | null): string {
  if (!openTime) return asStartInstant(startTime || "");
  return earlierInstant(openTime, startTime || "");
}

export function resolveCourseState(opts: {
  now: string;
  batchOpenTime?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  selected: boolean;
  availableSeats: number;
}): CourseState {
  if (opts.selected) return "selected";
  const now = asStartInstant(opts.now);
  if (opts.endTime && now >= asEndInstant(opts.endTime)) return "closed";
  if (opts.availableSeats <= 0) return "full";
  const open = effectiveOpenTime(opts.batchOpenTime, opts.startTime);
  if (now < open) return "waiting";
  return "open";
}
