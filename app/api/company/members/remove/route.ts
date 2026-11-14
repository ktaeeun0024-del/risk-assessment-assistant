// 직원 계정 삭제 (관리자 전용). 그 직원이 만든 평가표는 회사 기록에 남고 작성자만 '(삭제된 계정)'으로 보인다.
import { NextResponse } from "next/server";
import { authErrorResponse, checkSameOrigin, readJson, requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { listMembers, targetMember } from "@/lib/members";

export async function POST(request: Request) {
  try {
    checkSameOrigin(request);
    const admin = await requireAdmin();
    const id = await targetMember(admin, (await readJson(request)).userId);
    await (await db()).query(`DELETE FROM users WHERE id = $1 AND company_id = $2`, [id, admin.companyId]);
    return NextResponse.json({ members: await listMembers(admin.companyId) });
  } catch (err) {
    return authErrorResponse(err, "members-remove");
  }
}
