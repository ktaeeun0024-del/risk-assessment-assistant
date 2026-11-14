// 직원 초대 수락: 초대 메일의 인증번호를 확인하고, 직원이 정한 비밀번호로 계정을 만든 뒤 로그인한다.
import { NextResponse } from "next/server";
import {
  AuthError,
  authErrorResponse,
  checkNewPassword,
  checkSameOrigin,
  hashPassword,
  normalizeEmail,
  readJson,
  startSession,
  userById,
} from "@/lib/auth";
import { checkCode, claimCode } from "@/lib/codes";
import { dbErrorCode, transaction } from "@/lib/db";

export async function POST(request: Request) {
  try {
    checkSameOrigin(request);
    const body = await readJson(request);
    const email = normalizeEmail(body.email);
    const password = checkNewPassword(body.password, body.passwordConfirm);
    const row = await checkCode("invite", email, body.code);
    const name = String(row.payload.name ?? "").trim() || email.split("@")[0];
    const passwordHash = await hashPassword(password);

    const userId = await transaction(async (client) => {
      await claimCode(client, row.id);
      const company = await client.query(`SELECT status FROM companies WHERE id = $1`, [row.companyId]);
      if (company.rows[0]?.status !== "approved") {
        throw new AuthError("초대한 회사를 지금은 이용할 수 없어요. 회사 관리자에게 문의해 주세요.", 403);
      }
      const user = await client.query(
        `INSERT INTO users (company_id, email, name, password_hash, role) VALUES ($1, $2, $3, $4, 'member') RETURNING id`,
        [row.companyId, email, name, passwordHash],
      );
      return user.rows[0].id as number;
    }).catch((err) => {
      if (dbErrorCode(err) === "23505") throw new AuthError("이미 가입된 이메일이에요. 로그인해 주세요.", 409);
      throw err;
    });

    await startSession(userId, request);
    return NextResponse.json({ user: await userById(userId) });
  } catch (err) {
    return authErrorResponse(err, "invite-accept");
  }
}
