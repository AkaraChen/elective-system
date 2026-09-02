export const BUSINESS_TIME_ZONE = "Asia/Shanghai";

const chinaFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: BUSINESS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

const LOCAL_DT =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/;

function chinaParts(d: Date): Record<string, string> {
  return Object.fromEntries(
    chinaFormatter.formatToParts(d).map(({ type, value }) => [type, value]),
  );
}

export function toLocalISO(d: Date): string {
  const parts = chinaParts(d);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}

export function toLocalISOShort(d: Date): string {
  return toLocalISO(d).substring(0, 16);
}

export function nowLocal(now: Date = new Date()): string {
  return toLocalISO(now);
}

export function normalizeStartOfDay(dateStr: string): string {
  if (!dateStr) return dateStr;
  return dateStr.substring(0, 10) + "T00:00:00";
}

export function normalizeEndOfDay(dateStr: string): string {
  if (!dateStr) return dateStr;
  return dateStr.substring(0, 10) + "T23:59:59";
}

export function defaultStartTime(now: Date = new Date()): string {
  return `${chinaParts(now).year}-09-05T00:00:00`;
}

export function defaultEndTime(now: Date = new Date()): string {
  return `${chinaParts(now).year}-09-30T23:59:59`;
}

export function parseLocalDateTime(s: string): Date | null {
  if (!s) return null;
  const m = s.trim().match(LOCAL_DT);
  if (!m) return null;
  const expected = `${m[1]}-${m[2]}-${m[3]}T${m[4] || "00"}:${m[5] || "00"}:${m[6] || "00"}`;
  const d = new Date(`${expected}+08:00`);
  if (Number.isNaN(d.getTime()) || toLocalISO(d) !== expected) return null;
  return d;
}

export function isValidLocalDateTime(s: string): boolean {
  return parseLocalDateTime(s) !== null;
}

export function normalizeLocalDateTime(s: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(s.trim())) return null;
  const parsed = parseLocalDateTime(s);
  return parsed ? toLocalISO(parsed) : null;
}

export function asStartInstant(s: string): string {
  if (!s) return s;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s + "T00:00:00";
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) return s + ":00";
  return s;
}

export function asEndInstant(s: string): string {
  if (!s) return s;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s + "T23:59:59";
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) return s + ":59";
  return s;
}

export function laterInstant(a: string, b: string): string {
  if (!a) return asStartInstant(b);
  if (!b) return asStartInstant(a);
  const aa = asStartInstant(a);
  const bb = asStartInstant(b);
  return aa >= bb ? aa : bb;
}

export function future(now: Date = new Date()): { mar1: Date; sep1: Date } {
  const year = Number(chinaParts(now).year);
  const mar1This = new Date(`${year}-03-01T00:00:00+08:00`);
  const sep1This = new Date(`${year}-09-01T00:00:00+08:00`);
  return {
    mar1: mar1This > now ? mar1This : new Date(`${year + 1}-03-01T00:00:00+08:00`),
    sep1: sep1This > now ? sep1This : new Date(`${year + 1}-09-01T00:00:00+08:00`),
  };
}
