import { asEndInstant, asStartInstant, laterInstant } from "./time";

export type CourseState = "waiting" | "open" | "selected" | "full" | "closed";

export function effectiveOpenTime(openTime: string, startTime?: string | null): string {
  return laterInstant(openTime, startTime || "");
}

export function resolveCourseState(opts: {
  now: string;
  openTime: string;
  startTime?: string | null;
  endTime?: string | null;
  selected: boolean;
  availableSeats: number;
}): CourseState {
  if (opts.selected) return "selected";
  const now = asStartInstant(opts.now);
  if (opts.endTime && now >= asEndInstant(opts.endTime)) return "closed";
  if (opts.availableSeats <= 0) return "full";
  const open = effectiveOpenTime(opts.openTime, opts.startTime);
  if (now < open) return "waiting";
  return "open";
}
