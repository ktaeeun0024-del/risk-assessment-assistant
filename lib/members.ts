// 직원 관리 (회사 관리자 전용): 직원 목록 · 초대 목록. 모든 쿼리에 관리자의 company_id 조건을 건다.
import { AuthError, type SessionUser } from "./auth";
import { sendCode } from "./codes";
import { db } from "./db";
import { siteUrl } from "./mail";

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

// 아직 수락하지 않은 직원 초대 (만료 전)
export type Invite = { id: number; name: string; email: string; expiresAt: string; createdAt: string };

export async function listInvites(companyId: number): Promise<Invite[]> {
  const { rows } = await (await db()).query(
    `SELECT id, payload->>'name' AS name, email, expires_at AS "expiresAt", created_at AS "createdAt"
       FROM email_codes
      WHERE purpose = 'invite' AND company_id = $1 AND used_at IS NULL AND expires_at > now()
      ORDER BY created_at DESC`,
    [companyId],
  );
  return rows.map((r) => ({
    ...r,
    expiresAt: new Date(r.expiresAt).toISOString(),
    createdAt: new Date(r.createdAt).toISOString(),
  }));
}

export async function companyState(companyId: number) {
  const [members, invites] = await Promise.all([listMembers(companyId), listInvites(companyId)]);
  return { members, invites };
}

// 직원 초대 메일 (인증번호 포함). 다시 보내기에도 쓴다.
export async function sendInvite(
  request: Request,
  companyId: number,
  companyName: string,
  inviter: string,
  name: string,
  email: string,
) {
  const link = siteUrl(request);
  await sendCode({
    purpose: "invite",
    email,
    companyId,
    payload: { name },
    subject: `${companyName} 직원 초대`,
    intro: [
      `${name}님, ${inviter}님이 '${companyName}'의 반장노트에 초대했어요.`,
      "",
      `사이트에서 '초대받았어요'를 누르고 이 이메일(${email})과 아래 인증번호를 넣은 뒤 비밀번호를 정하면 가입돼요.`,
    ].join("\n"),
    link,
  });
}
