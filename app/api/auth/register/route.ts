// 회사 등록: 회사와 첫 관리자 계정을 함께 만들고 바로 로그인한다.
// 직원은 스스로 가입하지 않고, 관리자가 '직원 관리'에서 계정을 만든다.
import { NextResponse } from "next/server";
import {
  AuthError,
  authErrorResponse,
  checkPassword,
  checkSameOrigin,
  cleanName,
  hashPassword,
  normalizeEmail,
  readJson,
  startSession,
  userById,
} from "@/lib/auth";
import { dbErrorCode, transaction } from "@/lib/db";

export async function POST(request: Request) {
  try {
    checkSameOrigin(request);
    const body = await readJson(request);
    const companyName = cleanName(body.companyName, "회사 이름", 80);
    const name = cleanName(body.name, "이름");
    const email = normalizeEmail(body.email);
    const passwordHash = await hashPassword(checkPassword(body.password));

    const userId = await transaction(async (client) => {
      const company = await client.query(`INSERT INTO companies (name) VALUES ($1) RETURNING id`, [companyName]);
      const user = await client.query(
        `INSERT INTO users (company_id, email, name, password_hash, role)
         VALUES ($1, $2, $3, $4, 'admin') RETURNING id`,
        [company.rows[0].id, email, name, passwordHash],
      );
      return user.rows[0].id as number;
    }).catch((err) => {
      if (dbErrorCode(err) === "23505") throw new AuthError("이미 가입된 이메일이에요. 로그인해 주세요.", 409);
      throw err;
    });

    await startSession(userId, request);
    return NextResponse.json({ user: await userById(userId) });
  } catch (err) {
    return authErrorResponse(err, "register");
  }
}
