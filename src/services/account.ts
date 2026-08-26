import { parseGrade } from "../utils/grade";

export type AccountInput = {
  username: string;
  nickname: string;
  grade: number | null;
};

export function parseAccountInput(input: {
  username: unknown;
  nickname: unknown;
  grade: unknown;
  isAdmin: boolean;
}): { ok: true; value: AccountInput } | { ok: false; error: string } {
  const username = typeof input.username === "string" ? input.username.trim() : "";
  const nickname = typeof input.nickname === "string" ? input.nickname.trim() : "";

  if (!username) return { ok: false, error: "用户名不能为空" };
  if (username.length > 64) return { ok: false, error: "用户名不能超过64个字符" };
  if (!nickname) return { ok: false, error: "昵称不能为空" };
  if (nickname.length > 100) return { ok: false, error: "昵称不能超过100个字符" };

  const grade = input.isAdmin ? null : parseGrade(input.grade);
  if (!input.isAdmin && grade === null) {
    return { ok: false, error: "学生年级必须是4位数字，例如2026" };
  }

  return { ok: true, value: { username, nickname, grade } };
}
