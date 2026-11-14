// 이메일 인증번호: 만들기 · 확인 · 사용 처리. 서버에서만 쓴다.
//
// - 6자리 숫자. DB에는 솔트를 붙인 SHA-256 값만 저장한다.
// - 같은 이메일·용도로 새 번호를 보내면 이전 번호는 쓸 수 없게 된다.
// - 다시 보내기는 60초에 한 번, 1시간에 5번까지.
// - 5번 틀리면 그 번호는 더 이상 쓸 수 없다 (새 번호를 받아야 함).
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import type { PoolClient } from "pg";
import { AuthError } from "./auth";
import { db } from "./db";
import { codeMailText, sendMail } from "./mail";

export type Purpose = "register" | "invite" | "reset";

export const CODE_MINUTES: Record<Purpose, number> = { register: 10, invite: 24 * 60, reset: 10 };
const RESEND_SECONDS = 60;
const MAX_PER_HOUR = 5;
const MAX_ATTEMPTS = 5;

const hashCode = (salt: string, code: string) => createHash("sha256").update(`${salt}:${code}`).digest("hex");

export type CodeRow = {
  id: number;
  email: string;
  payload: Record<string, unknown>;
  companyId: number | null;
};

// 새 인증번호를 만들고 번호와 행 번호를 돌려준다. 메일 발송은 sendCodeMail로 한다.
export async function issueCode(opts: {
  purpose: Purpose;
  email: string;
  payload?: Record<string, unknown>;
  companyId?: number;
}): Promise<{ code: string; id: number }> {
  const pool = await db();
  const { rows } = await pool.query(
    `SELECT count(*)::int AS hour,
            count(*) FILTER (WHERE created_at > now() - make_interval(secs => $3))::int AS recent
       FROM email_codes
      WHERE email = $1 AND purpose = $2 AND created_at > now() - interval '1 hour'`,
    [opts.email, opts.purpose, RESEND_SECONDS],
  );
  if (rows[0].recent > 0) throw new AuthError(`인증번호는 ${RESEND_SECONDS}초에 한 번만 보낼 수 있어요. 잠시 후 다시 시도해 주세요.`, 429);
  if (rows[0].hour >= MAX_PER_HOUR) throw new AuthError("인증번호를 너무 많이 요청했어요. 1시간 뒤에 다시 시도해 주세요.", 429);

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const salt = randomBytes(16).toString("hex");
  await pool.query(
    `UPDATE email_codes SET used_at = now() WHERE email = $1 AND purpose = $2 AND used_at IS NULL`,
    [opts.email, opts.purpose],
  );
  const inserted = await pool.query(
    `INSERT INTO email_codes (purpose, email, code_hash, payload, company_id, expires_at)
     VALUES ($1, $2, $3, $4, $5, now() + make_interval(mins => $6)) RETURNING id`,
    [opts.purpose, opts.email, `${salt}$${hashCode(salt, code)}`, opts.payload ?? {}, opts.companyId ?? null, CODE_MINUTES[opts.purpose]],
  );
  // 오래된 번호는 가끔 정리한다
  pool.query(`DELETE FROM email_codes WHERE created_at < now() - interval '7 days'`).catch(() => undefined);
  return { code, id: inserted.rows[0].id };
}

// 인증번호를 만들어 메일로 보낸다. 메일을 못 보내면 번호를 지워서 바로 다시 요청할 수 있게 한다.
export async function sendCode(
  opts: Parameters<typeof issueCode>[0] & { subject: string; intro: string; link: string },
): Promise<void> {
  const { code, id } = await issueCode(opts);
  try {
    await sendMail(opts.email, opts.subject, codeMailText(opts.intro, code, CODE_MINUTES[opts.purpose], opts.link));
  } catch (err) {
    await (await db()).query(`DELETE FROM email_codes WHERE id = $1`, [id]).catch(() => undefined);
    throw err;
  }
}

// 번호가 맞는지 확인한다. 틀리면 시도 횟수를 올리고 AuthError. 맞으면 행을 돌려준다 (아직 사용 처리는 안 함).
export async function checkCode(purpose: Purpose, email: string, code: unknown): Promise<CodeRow> {
  const input = typeof code === "string" ? code.replace(/\s/g, "") : "";
  const invalid = new AuthError("인증번호가 맞지 않거나 만료됐어요. 다시 확인하거나 새 번호를 받아 주세요.", 400);
  if (!/^\d{6}$/.test(input)) throw invalid;

  const pool = await db();
  const { rows } = await pool.query(
    `SELECT id, email, code_hash, payload, company_id AS "companyId", attempts
       FROM email_codes
      WHERE email = $1 AND purpose = $2 AND used_at IS NULL AND expires_at > now()
      ORDER BY created_at DESC LIMIT 1`,
    [email, purpose],
  );
  const row = rows[0];
  if (!row) throw invalid;
  if (row.attempts >= MAX_ATTEMPTS) {
    throw new AuthError(`인증번호를 ${MAX_ATTEMPTS}번 틀렸어요. 새 번호를 받아 주세요.`, 429);
  }
  const [salt, expected] = String(row.code_hash).split("$");
  const actual = hashCode(salt, input);
  if (!timingSafeEqual(Buffer.from(actual), Buffer.from(expected))) {
    await pool.query(`UPDATE email_codes SET attempts = attempts + 1 WHERE id = $1`, [row.id]);
    throw invalid;
  }
  return { id: row.id, email: row.email, payload: row.payload ?? {}, companyId: row.companyId };
}

// 트랜잭션 안에서 번호를 사용 처리한다. 동시에 두 번 쓰는 것을 막는다.
export async function claimCode(client: PoolClient, id: number): Promise<void> {
  const { rowCount } = await client.query(
    `UPDATE email_codes SET used_at = now() WHERE id = $1 AND used_at IS NULL AND expires_at > now()`,
    [id],
  );
  if (!rowCount) throw new AuthError("인증번호가 이미 사용됐거나 만료됐어요. 새 번호를 받아 주세요.", 400);
}
