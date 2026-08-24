export type GradeOrder = "enrollment" | "graduation";

export function isGradeOrder(value: string): value is GradeOrder {
  return value === "enrollment" || value === "graduation";
}

export function studentCohort(year: number | null | undefined): number | null {
  return parseYear(year);
}

export function parseAllowedGrades(raw: string | null | undefined): number[] | null {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  const parts = trimmed.split(/[,，、\s]+/).filter(Boolean);
  if (parts.length === 0) return null;
  const grades: number[] = [];
  for (const part of parts) {
    if (!/^\d{4}$/.test(part)) return null;
    const n = Number(part);
    if (n < 1000) return null;
    if (!grades.includes(n)) grades.push(n);
  }
  grades.sort((a, b) => a - b);
  return grades;
}

export function serializeAllowedGrades(grades: number[]): string {
  return [...grades].sort((a, b) => a - b).join(",");
}

export function formatAllowedGrades(raw: string | null | undefined): string {
  const grades = parseAllowedGrades(raw);
  if (!grades) return "不限";
  return grades.map((grade) => `${grade}级`).join("、");
}

export function isGradeAllowed(
  grade: number | null,
  allowedRaw: string | null | undefined,
): boolean {
  if (allowedRaw == null || String(allowedRaw).trim() === "") return true;
  const allowed = parseAllowedGrades(allowedRaw);
  if (!allowed) return false;
  if (grade == null) return false;
  return allowed.includes(grade);
}

export function parseYear(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const value = typeof raw === "number" ? String(raw) : String(raw).trim();
  if (!/^\d{4}$/.test(value)) return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1000) return null;
  return n;
}
