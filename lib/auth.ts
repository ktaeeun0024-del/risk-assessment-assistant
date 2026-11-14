// 로그인: 비밀번호 암호화, 세션(쿠키), 권한 확인. 서버에서만 쓴다.
//
// - 비밀번호는 scrypt(솔트 포함)로 바꿔 저장하고 원문은 어디에도 남기지 않는다.
// - 로그인하면 임의의 토큰을 HttpOnly 쿠키로 주고, DB에는 토큰의 SHA-256 값만 저장한다.
//   DB가 유출돼도 쿠키를 만들어 낼 수 없다.
// - 같은 이메일로 5번 연속 틀리면 10분 동안 잠근다.
// - 회사는 사이트 관리자(환경변수 SITE_ADMIN_EMAILS)가 승인해야 로그인할 수 있다.
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { db } from "./db";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, keylen: number, opts: object) => Promise<Buffer>;

export const SESSION_COOKIE = "ra_session";
const SESSION_DAYS = 7;
const MAX_FAILED = 5;
const LOCK_MINUTES = 10;
const SCRYPT = { N: 16384, r: 8, p: 1 };
export const PASSWORD_MIN = 8;
const PASSWORD_MAX = 72;

export type Role = "admin" | "member";

export type SessionUser = {
  id: number;
  email: string;
  name: string;
  role: Role;
  companyId: number;
  companyName: string;
  mustChangePassword: boolean;
  isSiteAdmin: boolean;
};

// 사이트 관리자: 회사 가입을 승인하는 사람. 쉼표로 여러 명을 적을 수 있다.
export function siteAdminEmails(): string[] {
  return (process.env.SITE_ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export const isSiteAdminEmail = (email: string) => siteAdminEmails().includes(email.toLowerCase());

// 사람이 읽을 메시지와 HTTP 상태를 함께 담는 오류
export class AuthError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

export function authErrorResponse(err: unknown, tag: string) {
  if (err instanceof AuthError) {
    return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
  }
  console.error(`[${tag}] 알 수 없는 오류`);
  return NextResponse.json({ error: "요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요." }, { status: 500 });
}

// ---- 입력 확인 ----

export function normalizeEmail(v: unknown): string {
  const email = typeof v === "string" ? v.trim().toLowerCase() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) {
    throw new AuthError("이메일 형식을 확인해 주세요.", 400);
  }
  return email;
}

export function cleanName(v: unknown, label: string, max = 50): string {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s) throw new AuthError(`${label}을(를) 입력해 주세요.`, 400);
  if (s.length > max) throw new AuthError(`${label}은(는) ${max}자 이내로 입력해 주세요.`, 400);
  return s;
}

export function checkPassword(v: unknown): string {
  const pw = typeof v === "string" ? v : "";
  if (pw.length < PASSWORD_MIN || pw.length > PASSWORD_MAX) {
    throw new AuthError(`비밀번호는 ${PASSWORD_MIN}~${PASSWORD_MAX}자로 정해 주세요.`, 400);
  }
  return pw;
}

// ---- 비밀번호 ----

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, N, r, p, saltB64, hashB64] = stored.split("$");
  if (algo !== "scrypt") return false;
  const expected = Buffer.from(hashB64, "base64");
  const actual = await scrypt(password, Buffer.from(saltB64, "base64"), expected.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// 로그인 실패 처리. 성공하면 계정을, 실패하면 AuthError를 던진다. 이메일이 있는지 없는지 알려 주지 않는다.
export async function checkLogin(email: string, password: string): Promise<{ id: number }> {
  const pool = await db();
  const { rows } = await pool.query(
    `SELECT u.id, u.password_hash, u.failed_logins, u.locked_until, c.status AS company_status
       FROM users u JOIN companies c ON c.id = u.company_id
      WHERE u.email = $1`,
    [email],
  );
  const user = rows[0];
  const wrong = new AuthError("이메일 또는 비밀번호가 맞지 않아요.", 401);
  if (!user) {
    await verifyPassword(password, await dummyHash()); // 계정이 없을 때도 비슷한 시간이 걸리게
    throw wrong;
  }
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    throw new AuthError(`로그인을 ${MAX_FAILED}번 틀려서 잠시 잠겼어요. ${LOCK_MINUTES}분 뒤에 다시 시도해 주세요.`, 429);
  }
  if (!(await verifyPassword(password, user.password_hash))) {
    await pool.query(
      `UPDATE users SET failed_logins = failed_logins + 1,
              locked_until = CASE WHEN failed_logins + 1 >= $2 THEN now() + make_interval(mins => $3) END
        WHERE id = $1`,
      [user.id, MAX_FAILED, LOCK_MINUTES],
    );
    throw wrong;
  }
  await pool.query(`UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = $1`, [user.id]);
  // 비밀번호가 맞은 뒤에만 승인 상태를 알려 준다 (다른 사람이 가입 여부를 알아내지 못하게)
  if (user.company_status === "pending") {
    throw new AuthError("회사 가입 승인을 기다리고 있어요. 승인되면 메일로 알려 드려요.", 403, "COMPANY_PENDING");
  }
  if (user.company_status !== "approved") {
    throw new AuthError("회사 가입이 승인되지 않았어요. 사이트 관리자에게 문의해 주세요.", 403, "COMPANY_REJECTED");
  }
  return { id: user.id };
}

let dummy: Promise<string> | null = null;
const dummyHash = () => (dummy ??= hashPassword("dummy-password-for-timing"));

// ---- 세션 ----

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

function isHttps(request: Request): boolean {
  return request.headers.get("x-forwarded-proto") === "https" || new URL(request.url).protocol === "https:";
}

export async function startSession(userId: number, request: Request): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const pool = await db();
  await pool.query(
    `INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + make_interval(days => $3))`,
    [sha256(token), userId, SESSION_DAYS],
  );
  // 만료된 세션은 가끔 정리한다
  pool.query(`DELETE FROM sessions WHERE expires_at < now()`).catch(() => undefined);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isHttps(request),
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

export async function endSession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await (await db()).query(`DELETE FROM sessions WHERE token_hash = $1`, [sha256(token)]);
  store.delete(SESSION_COOKIE);
}

const USER_COLUMNS = `u.id, u.email, u.name, u.role, u.company_id AS "companyId", c.name AS "companyName",
            u.must_change_password AS "mustChangePassword"`;

const withFlags = (row: Omit<SessionUser, "isSiteAdmin"> | undefined): SessionUser | null =>
  row ? { ...row, isSiteAdmin: isSiteAdminEmail(row.email) } : null;

// 쿠키로 로그인한 계정을 찾는다. 없거나 만료됐거나 회사 승인이 취소됐으면 null.
export async function currentUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const { rows } = await (await db()).query(
    `SELECT ${USER_COLUMNS}
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       JOIN companies c ON c.id = u.company_id
      WHERE s.token_hash = $1 AND s.expires_at > now() AND c.status = 'approved'`,
    [sha256(token)],
  );
  return withFlags(rows[0]);
}

// 로그인·가입 직후처럼 쿠키를 막 심은 요청에서 계정 정보를 돌려줄 때 쓴다
export async function userById(id: number): Promise<SessionUser> {
  const { rows } = await (await db()).query(
    `SELECT ${USER_COLUMNS} FROM users u JOIN companies c ON c.id = u.company_id WHERE u.id = $1`,
    [id],
  );
  return withFlags(rows[0]) as SessionUser;
}

// 로그인 필수. 임시 비밀번호를 아직 안 바꿨으면 다른 기능을 막는다.
export async function requireUser(opts: { allowPasswordChange?: boolean } = {}): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) throw new AuthError("로그인이 필요해요.", 401, "LOGIN_REQUIRED");
  if (user.mustChangePassword && !opts.allowPasswordChange) {
    throw new AuthError("임시 비밀번호를 먼저 새 비밀번호로 바꿔 주세요.", 403, "PASSWORD_CHANGE_REQUIRED");
  }
  return user;
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "admin") throw new AuthError("회사 관리자만 할 수 있어요.", 403);
  return user;
}

export async function requireSiteAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (!user.isSiteAdmin) throw new AuthError("사이트 관리자만 할 수 있어요.", 403);
  return user;
}

export function checkNewPassword(password: unknown, confirm?: unknown): string {
  const pw = checkPassword(password);
  if (confirm !== undefined && confirm !== pw) throw new AuthError("비밀번호 두 칸이 서로 달라요.", 400);
  return pw;
}

// 다른 사이트가 사용자 몰래 요청을 보내는 것(CSRF)을 막는다. 브라우저가 붙이는 Origin이 이 사이트와 다르면 거절.
export function checkSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin) return; // 브라우저가 아닌 요청(curl 등)은 쿠키가 없으면 어차피 로그인 상태가 아니다
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!host || new URL(origin).host !== host) {
    throw new AuthError("허용되지 않은 요청이에요.", 403);
  }
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    return typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  } catch {
    throw new AuthError("잘못된 요청입니다.", 400);
  }
}
