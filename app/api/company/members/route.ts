// GET: 우리 회사 계정 목록과 수락 전 초대 목록 / POST: 직원 초대 메일 보내기 (회사 관리자 전용)
// 초대받은 직원은 메일의 인증번호로 본인 확인을 하고 자기 비밀번호를 정해 가입한다 (/api/auth/invite).
import { NextResponse } from "next/server";
import {
  AuthError,
  authErrorResponse,
  checkSameOrigin,
  cleanName,
  normalizeEmail,
  readJson,
  requireAdmin,
} from "@/lib/auth";
import { db } from "@/lib/db";
import { companyState, sendInvite } from "@/lib/members";

export async function GET() {
  try {
    const admin = await requireAdmin();
    return NextResponse.json(await companyState(admin.companyId));
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
    const taken = await (await db()).query(`SELECT 1 FROM users WHERE email = $1`, [email]);
    if (taken.rowCount) throw new AuthError("이미 가입된 이메일이에요.", 409);

    await sendInvite(request, admin.companyId, admin.companyName, admin.name, name, email);
    return NextResponse.json(await companyState(admin.companyId));
  } catch (err) {
    return authErrorResponse(err, "members");
  }
}
