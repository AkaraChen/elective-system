import { parseGrade } from "../utils/grade";
import { isValidPhone, normalizePhone } from "../utils/phone";

export type ProfileInput = {
  grade: number;
  className: string | null;
  phone: string;
  password: string | null;
};

export function parseProfileInput(input: {
  grade: unknown;
  className: unknown;
  phone: unknown;
  password: unknown;
}): { ok: true; value: ProfileInput } | { ok: false; error: string } {
  const grade = parseGrade(input.grade);
  if (grade === null) {
    return { ok: false, error: "学生年级必须是4位数字，例如2026" };
  }

  const className = typeof input.className === "string" ? input.className.trim() : "";
  if (className.length > 100) {
    return { ok: false, error: "班级不能超过100个字符" };
  }

  const phone = normalizePhone(input.phone);
  if (!phone) {
    return { ok: false, error: "手机号必须填写" };
  }
  if (!isValidPhone(phone)) {
    return { ok: false, error: "手机号格式不正确，请输入11位中国大陆手机号" };
  }

  const password = typeof input.password === "string" ? input.password : "";
  if (password.length > 200) {
    return { ok: false, error: "密码不能超过200个字符" };
  }

  return {
    ok: true,
    value: {
      grade,
      className: className || null,
      phone,
      password: password || null,
    },
  };
}
