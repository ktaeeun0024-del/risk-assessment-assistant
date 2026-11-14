// 직원 관리 (회사 관리자 전용). 모든 쿼리에 관리자의 company_id 조건을 건다.
import { AuthError, type SessionUser } from "./auth";
import { db } from "./db";

export type Member = {
  id: number;
  name: string;
  email: string;
  role: "admin" | "member";
  mustChangePassword: boolean;
  createdAt: string;
};

export async function listMembers(companyId: number): Promise<Member[]> {
  const { rows } = await (await db()).query(
    `SELECT id, name, email, role, must_change_password AS "mustChangePassword", created_at AS "createdAt"
       FROM users WHERE company_id = $1 ORDER BY role, created_at`,
    [companyId],
  );
  return rows.map((r) => ({ ...r, createdAt: new Date(r.createdAt).toISOString() }));
}

// 다른 회사 직원이나 자기 자신은 건드릴 수 없게 확인한다. 다른 회사 계정은 '없는 계정'으로 답한다.
export async function targetMember(admin: SessionUser, userId: unknown): Promise<number> {
  const id = Number(userId);
  if (!Number.isInteger(id)) throw new AuthError("직원을 다시 골라 주세요.", 400);
  if (id === admin.id) throw new AuthError("내 계정은 여기서 바꿀 수 없어요. '비밀번호 변경'을 이용해 주세요.", 400);
  const { rows } = await (await db()).query(`SELECT id FROM users WHERE id = $1 AND company_id = $2`, [
    id,
    admin.companyId,
  ]);
  if (!rows[0]) throw new AuthError("우리 회사에 없는 계정이에요.", 404);
  return id;
}
