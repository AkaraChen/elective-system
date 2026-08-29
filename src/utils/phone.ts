export const PHONE_PATTERN_SOURCE = "1[3-9][0-9]{9}";

const PHONE_PATTERN = new RegExp(`^${PHONE_PATTERN_SOURCE}$`);

export function normalizePhone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const phone = value.trim();
  return phone || null;
}

export function isValidPhone(phone: string): boolean {
  return PHONE_PATTERN.test(phone);
}
