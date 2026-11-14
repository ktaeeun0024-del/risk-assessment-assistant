// 비밀번호 변경. 임시 비밀번호로 처음 로그인한 직원도 여기서 바꾼다.
// 바꾸면 이 계정의 다른 로그인(다른 기기)은 모두 끊는다.
import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  AuthError,
  authErrorResponse,
  checkPassword,
  checkSameOrigin,
  hashPassword,
  readJson,
  requireUser,
  SESSION_COOKIE,
  userById,
  verifyPassword,
} from "@/lib/auth";
import { db } from "@/lib/db";

export async function POST(request: Request) {
  try {
    checkSameOrigin(request);
    const user = await requireUser({ allowPasswordChange: true });
    const body = await readJson(request);
    const current = typeof body.currentPassword === "string" ? body.currentPassword : "";
    const next = checkPassword(body.newPassword);
    if (current === next) throw new AuthError("지금 비밀번호와 다른 비밀번호로 정해 주세요.", 400);

    const pool = await db();
    const { rows } = await pool.query(`SELECT password_hash FROM users WHERE id = $1`, [user.id]);
    if (!rows[0] || !(await verifyPassword(current, rows[0].password_hash))) {
      throw new AuthError("지금 비밀번호가 맞지 않아요.", 400);
    }
    await pool.query(`UPDATE users SET password_hash = $2, must_change_password = false WHERE id = $1`, [
      user.id,
      await hashPassword(next),
    ]);
    const token = (await cookies()).get(SESSION_COOKIE)?.value ?? "";
    const keep = createHash("sha256").update(token).digest("hex");
    await pool.query(`DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2`, [user.id, keep]);
    return NextResponse.json({ user: await userById(user.id) });
  } catch (err) {
    return authErrorResponse(err, "password");
  }
}
