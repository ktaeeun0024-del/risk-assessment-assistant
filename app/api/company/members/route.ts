// GET: 우리 회사 계정 목록 / POST: 직원 계정 만들기 (관리자 전용)
// 새 직원에게는 임시 비밀번호를 한 번만 보여 주고, 직원은 처음 로그인할 때 비밀번호를 바꿔야 한다.
import { NextResponse } from "next/server";
import {
  AuthError,
  authErrorResponse,
  checkSameOrigin,
  cleanName,
  hashPassword,
  normalizeEmail,
  readJson,
  requireAdmin,
  tempPassword,
} from "@/lib/auth";
import { db, dbErrorCode } from "@/lib/db";
import { listMembers } from "@/lib/members";

export async function GET() {
  try {
    const admin = await requireAdmin();
    return NextResponse.json({ members: await listMembers(admin.companyId) });
  } catch (err) {
    return authErrorResponse(err, "members");
  }
}

export async function POST(request: Request) {
  try {
    checkSameOrigin(request);
    const admin = await requireAdmin();
    const body = await readJson(request);
    const name = cleanName(body.name, "직원 이름");
    const email = normalizeEmail(body.email);
    const password = tempPassword();
    await (await db())
      .query(
        `INSERT INTO users (company_id, email, name, password_hash, role, must_change_password)
         VALUES ($1, $2, $3, $4, 'member', true)`,
        [admin.companyId, email, name, await hashPassword(password)],
      )
      .catch((err) => {
        if (dbErrorCode(err) === "23505") throw new AuthError("이미 가입된 이메일이에요.", 409);
        throw err;
      });
    return NextResponse.json({ members: await listMembers(admin.companyId), tempPassword: password, email });
  } catch (err) {
    return authErrorResponse(err, "members");
  }
}
