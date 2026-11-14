// PostgreSQL 접속과 테이블 준비. 서버에서만 쓴다.
//
// 테이블: companies(회사) / users(계정, 회사 하나에 속함) / sessions(로그인 상태) / assessment_history(평가표 기록)
// 회사별 분리: 평가표 기록은 반드시 로그인한 계정의 company_id로만 저장·조회한다. company_id는 화면에서 받지 않는다.
// Supabase에서는 모든 테이블에 RLS를 켜 두고 정책을 만들지 않는다. 그러면 Supabase의 공개 REST API(anon 키)로는
// 아무 행도 읽을 수 없고, 이 앱(테이블 소유자 계정으로 접속)만 읽고 쓸 수 있다.
import { Pool, type PoolClient } from "pg";

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS companies (
    id         serial PRIMARY KEY,
    name       text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS users (
    id                   serial PRIMARY KEY,
    company_id           integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    email                text NOT NULL UNIQUE,
    name                 text NOT NULL,
    password_hash        text NOT NULL,
    role                 text NOT NULL CHECK (role IN ('admin', 'member')),
    must_change_password boolean NOT NULL DEFAULT false,
    failed_logins        integer NOT NULL DEFAULT 0,
    locked_until         timestamptz,
    created_at           timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS users_company_idx ON users(company_id);
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash text PRIMARY KEY,
    user_id    integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
  CREATE TABLE IF NOT EXISTS assessment_history (
    id          serial PRIMARY KEY,
    title       text NOT NULL,
    description text NOT NULL,
    mode        text NOT NULL,
    model       text NOT NULL,
    item_count  integer NOT NULL,
    passed      boolean NOT NULL,
    assessment  jsonb NOT NULL,
    report      jsonb NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
  );
  -- 로그인 기능 이전에 만든 테이블에도 회사·작성자 칸을 더한다. 회사가 없는 옛 기록은 어느 회사에도 보이지 않는다.
  ALTER TABLE assessment_history ADD COLUMN IF NOT EXISTS company_id integer REFERENCES companies(id) ON DELETE CASCADE;
  ALTER TABLE assessment_history ADD COLUMN IF NOT EXISTS user_id integer REFERENCES users(id) ON DELETE SET NULL;
  CREATE INDEX IF NOT EXISTS history_company_idx ON assessment_history(company_id, created_at DESC);
  ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
  ALTER TABLE users ENABLE ROW LEVEL SECURITY;
  ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
  ALTER TABLE assessment_history ENABLE ROW LEVEL SECURITY;
`;

// 개발 서버가 코드를 다시 불러와도 연결 풀이 계속 늘어나지 않도록 하나만 만들어 재사용한다.
const globalForDb = globalThis as unknown as {
  pool?: Pool;
  schemaReady?: Promise<void>;
};

function getPool(): Pool {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw Object.assign(new Error("DATABASE_URL이 설정되지 않았습니다."), { code: "NO_DATABASE_URL" });
  }
  if (!globalForDb.pool) {
    // Supabase는 SSL 접속이 필요하다. Supabase 인증서는 공개 인증기관 것이 아니라 검증은 끈다
    // (Supabase 안내 방식). 주소의 sslmode는 아래 ssl 설정과 겹치지 않게 뺀다.
    const remoteSsl = /supabase\.(co|com)/.test(url) || process.env.DATABASE_SSL === "true";
    globalForDb.pool = new Pool({
      connectionString: remoteSsl ? url.replace(/([?&])sslmode=[^&]*&?/, "$1").replace(/[?&]$/, "") : url,
      ssl: remoteSsl ? { rejectUnauthorized: false } : undefined,
      max: 5,
      connectionTimeoutMillis: 5_000,
    });
  }
  return globalForDb.pool;
}

// 테이블은 처음 쓸 때 없으면 만든다. 실패하면 다음 요청에서 다시 시도한다.
export async function db(): Promise<Pool> {
  const pool = getPool();
  globalForDb.schemaReady ??= pool
    .query(SCHEMA)
    .then(() => undefined)
    .catch((err) => {
      globalForDb.schemaReady = undefined;
      throw err;
    });
  await globalForDb.schemaReady;
  return pool;
}

// 여러 쿼리를 한 번에 성공하거나 한 번에 취소한다 (예: 회사와 관리자 계정을 함께 만들기)
export async function transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await (await db()).connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

// 오류 내용에 접속 정보가 섞일 수 있어 로그에는 오류 코드만 남긴다.
export function dbErrorCode(err: unknown): string {
  return typeof err === "object" && err !== null && "code" in err
    ? String((err as { code: unknown }).code)
    : "unknown";
}
