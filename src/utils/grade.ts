export const DEFAULT_PROGRAM_YEARS = 3;

export type GradeOrder = "enrollment" | "graduation";

export function isGradeOrder(value: string): value is GradeOrder {
  return value === "enrollment" || value === "graduation";
}

export function academicYear(now: Date = new Date()): number {
  return now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
}

export function studentGrade(
  year: number | null | undefined,
  order: GradeOrder,
  now: Date = new Date(),
  programYears: number = DEFAULT_PROGRAM_YEARS,
): number | null {
  if (year == null || !Number.isInteger(year)) return null;
  const ay = academicYear(now);
  const enrollmentYear = order === "enrollment" ? year : year - programYears;
  const grade = ay - enrollmentYear + 1;
  if (grade < 1 || grade > programYears + 2) return null;
  return grade;
}

export function parseAllowedGrades(raw: string | null | undefined): number[] | null {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  const parts = trimmed.split(/[,，、\s]+/).filter(Boolean);
  if (parts.length === 0) return null;
  const grades: number[] = [];
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isInteger(n) || n < 1) return null;
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
  return grades.join("、") + "年级";
}

export function isGradeAllowed(
  grade: number | null,
  allowedRaw: string | null | undefined,
): boolean {
  const allowed = parseAllowedGrades(allowedRaw);
  if (!allowed) return true;
  if (grade == null) return false;
  return allowed.includes(grade);
}

export function parseYear(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const n = typeof raw === "number" ? raw : parseInt(String(raw), 10);
  if (!Number.isInteger(n) || n < 1990 || n > 2100) return null;
  return n;
}
