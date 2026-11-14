// 비밀번호 찾기 2단계: 인증번호를 확인하고 새 비밀번호로 바꾼다. 잠금은 풀고, 모든 기기의 로그인을 끊는다.
import { NextResponse } from "next/server";
import { authErrorResponse, checkNewPassword, checkSameOrigin, hashPassword, normalizeEmail, readJson } from "@/lib/auth";
import { checkCode, claimCode } from "@/lib/codes";
import { transaction } from "@/lib/db";

export async function POST(request: Request) {
  try {
    checkSameOrigin(request);
    const body = await readJson(request);
    const email = normalizeEmail(body.email);
    const password = checkNewPassword(body.password, body.passwordConfirm);
    const row = await checkCode("reset", email, body.code);
    const passwordHash = await hashPassword(password);

    await transaction(async (client) => {
      await claimCode(client, row.id);
      const { rows } = await client.query(
        `UPDATE users SET password_hash = $2, must_change_password = false, failed_logins = 0, locked_until = NULL
          WHERE email = $1 RETURNING id`,
        [email, passwordHash],
      );
      if (rows[0]) await client.query(`DELETE FROM sessions WHERE user_id = $1`, [rows[0].id]);
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorResponse(err, "reset-verify");
  }
}
