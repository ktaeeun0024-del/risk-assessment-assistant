// 수락 전 직원 초대: 다시 보내기 · 취소 (회사 관리자 전용). 다른 회사의 초대는 '없는 초대'로 답한다.
import { NextResponse } from "next/server";
import { AuthError, authErrorResponse, checkSameOrigin, readJson, requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { companyState, sendInvite } from "@/lib/members";

export async function POST(request: Request) {
  try {
    checkSameOrigin(request);
    const admin = await requireAdmin();
    const body = await readJson(request);
    const id = Number(body.inviteId);
    if (!Number.isInteger(id)) throw new AuthError("초대를 다시 골라 주세요.", 400);

    const pool = await db();
    const { rows } = await pool.query(
      `SELECT email, payload->>'name' AS name FROM email_codes
        WHERE id = $1 AND purpose = 'invite' AND company_id = $2 AND used_at IS NULL`,
      [id, admin.companyId],
    );
    if (!rows[0]) throw new AuthError("이미 수락했거나 취소된 초대예요.", 404);

    if (body.action === "cancel") {
      await pool.query(`UPDATE email_codes SET used_at = now() WHERE id = $1 AND company_id = $2`, [id, admin.companyId]);
    } else if (body.action === "resend") {
      await sendInvite(request, admin.companyId, admin.companyName, admin.name, rows[0].name, rows[0].email);
    } else {
      throw new AuthError("잘못된 요청입니다.", 400);
    }
    return NextResponse.json(await companyState(admin.companyId));
  } catch (err) {
    return authErrorResponse(err, "invites");
  }
}
