// 직원 비밀번호를 잊었을 때: 새 임시 비밀번호를 발급하고, 그 직원의 로그인을 모두 끊는다 (관리자 전용)
import { NextResponse } from "next/server";
import { authErrorResponse, checkSameOrigin, hashPassword, readJson, requireAdmin, tempPassword } from "@/lib/auth";
import { transaction } from "@/lib/db";
import { listMembers, targetMember } from "@/lib/members";

export async function POST(request: Request) {
  try {
    checkSameOrigin(request);
    const admin = await requireAdmin();
    const id = await targetMember(admin, (await readJson(request)).userId);
    const password = tempPassword();
    const hash = await hashPassword(password);
    const email = await transaction(async (client) => {
      const { rows } = await client.query(
        `UPDATE users SET password_hash = $3, must_change_password = true, failed_logins = 0, locked_until = NULL
          WHERE id = $1 AND company_id = $2 RETURNING email`,
        [id, admin.companyId, hash],
      );
      await client.query(`DELETE FROM sessions WHERE user_id = $1`, [id]);
      return rows[0].email as string;
    });
    return NextResponse.json({ members: await listMembers(admin.companyId), tempPassword: password, email });
  } catch (err) {
    return authErrorResponse(err, "members-reset");
  }
}
