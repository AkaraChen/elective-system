const pad = (n: number) => String(n).padStart(2, "0");

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
