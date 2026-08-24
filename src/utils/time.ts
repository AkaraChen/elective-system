const pad = (n: number) => String(n).padStart(2, "0");

const LOCAL_DT =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/;

export function toLocalISO(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function toLocalISOShort(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function nowLocal(): string {
  return toLocalISO(new Date());
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
  return `${now.getFullYear()}-09-05T00:00:00`;
}

export function parseLocalDateTime(s: string): Date | null {
  if (!s) return null;
  const m = s.trim().match(LOCAL_DT);
  if (!m) return null;
  const d = new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4] || 0),
    Number(m[5] || 0),
    Number(m[6] || 0),
  );
  if (
    d.getFullYear() !== Number(m[1]) ||
    d.getMonth() !== Number(m[2]) - 1 ||
    d.getDate() !== Number(m[3])
  ) {
    return null;
  }
  return d;
}

export function isValidLocalDateTime(s: string): boolean {
  return parseLocalDateTime(s) !== null;
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

export function future(): { mar1: Date; sep1: Date } {
  const now = new Date();
  const year = now.getFullYear();
  const mar1This = new Date(year, 2, 1);
  const sep1This = new Date(year, 8, 1);
  return {
    mar1: mar1This > now ? mar1This : new Date(year + 1, 2, 1),
    sep1: sep1This > now ? sep1This : new Date(year + 1, 8, 1),
  };
}
