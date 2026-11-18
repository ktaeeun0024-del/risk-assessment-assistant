// 관리자 넘기기 (회사 관리자 전용, 11/18): 다른 직원을 관리자로 지정하거나 관리자에서 해제한다.
// 실무 관리자가 퇴사·이동해도 회사 계정이 한 사람에게 묶이지 않게 한다.
// 내 권한은 여기서 바꿀 수 없다 (다른 관리자를 지정한 뒤 그 사람이 해제한다). 회사에는 관리자가 늘 한 명 이상 남는다.
import { NextResponse } from "next/server";
import { AuthError, authErrorResponse, checkSameOrigin, readJson, requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { companyState, targetMember } from "@/lib/members";

export async function POST(request: Request) {
  try {
    checkSameOrigin(request);
    const admin = await requireAdmin();
    const body = await readJson(request);
    const id = await targetMember(admin, body.userId);
    const role = body.role === "admin" ? "admin" : body.role === "member" ? "member" : null;
    if (!role) throw new AuthError("잘못된 요청입니다.", 400);
    // 관리자를 해제할 때는 다른 관리자가 남아 있을 때만 (동시에 서로 해제해도 0명이 되지 않게 한 문장으로)
    const { rowCount } = await (await db()).query(
      `UPDATE users SET role = $3
        WHERE id = $1 AND company_id = $2
          AND ($3 = 'admin' OR (SELECT count(*) FROM users WHERE company_id = $2 AND role = 'admin' AND id <> $1) >= 1)`,
      [id, admin.companyId, role],
    );
    if (!rowCount) throw new AuthError("회사에 관리자가 한 명은 있어야 해요.", 409);
    return NextResponse.json(await companyState(admin.companyId));
  } catch (err) {
    return authErrorResponse(err, "members-role");
  }
}
