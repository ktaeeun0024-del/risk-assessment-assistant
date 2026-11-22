// PostgreSQL 접속과 테이블 준비. 서버에서만 쓴다.
//
// 테이블: companies(회사, 사이트 관리자 승인 필요) / users(계정, 회사 하나에 속함) / sessions(로그인 상태)
//        / assessment_history(평가표 기록) / email_codes(이메일 인증번호) / ai_jobs(배포 사이트의 AI 초안 작업)
//        / daily_checks(작업 전 점검 기록)
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

  -- 회사 가입 승인: 사업자등록번호와 승인 상태. 이 칸이 생기기 전에 만든 회사는 승인된 것으로 둔다.
  ALTER TABLE companies ADD COLUMN IF NOT EXISTS business_number text;
  ALTER TABLE companies ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'approved';
  ALTER TABLE companies ALTER COLUMN status SET DEFAULT 'pending';
  ALTER TABLE companies ADD COLUMN IF NOT EXISTS nts_check jsonb;
  ALTER TABLE companies ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
  ALTER TABLE companies ADD COLUMN IF NOT EXISTS reviewed_by text;
  DO $$ BEGIN
    ALTER TABLE companies ADD CONSTRAINT companies_status_check CHECK (status IN ('pending', 'approved', 'rejected'));
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  -- 같은 사업자등록번호로 승인된 회사는 하나만. (11/18) 승인 대기는 여러 개 받는다:
  -- 남이 번호를 먼저 신청해 두면 진짜 회사가 가입하지 못하는 '번호 선점'을 막고, 사이트 관리자가 진짜를 골라 승인한다.
  -- 예전 코드(배포 사이트)가 같은 이름으로 'IF NOT EXISTS' 생성을 하므로 이름은 그대로 두고 조건만 바꾼다.
  DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'companies_business_number_idx'
                AND indexdef NOT LIKE '%''approved''%') THEN
      DROP INDEX companies_business_number_idx;
    END IF;
  END $$;
  CREATE UNIQUE INDEX IF NOT EXISTS companies_business_number_idx
    ON companies(business_number) WHERE business_number IS NOT NULL AND status = 'approved';
  -- 진위확인 (11/18): 대표자 성명·개업일자(사업자등록증 그대로), 신청자 직책, 국세청 진위확인 결과
  ALTER TABLE companies ADD COLUMN IF NOT EXISTS rep_name text;
  ALTER TABLE companies ADD COLUMN IF NOT EXISTS start_date text;
  ALTER TABLE companies ADD COLUMN IF NOT EXISTS applicant_title text;
  ALTER TABLE companies ADD COLUMN IF NOT EXISTS nts_validate jsonb;
  -- 진위확인 시도 기록: 번호 하나에 1시간 5번까지 (대표자 이름을 아는 사람이 개업일자를 하나씩 맞혀 보는 것을 막는다)
  CREATE TABLE IF NOT EXISTS nts_attempts (
    id              serial PRIMARY KEY,
    business_number text NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS nts_attempts_idx ON nts_attempts(business_number, created_at DESC);

  -- 작업 전 점검 기록 (11/24): 평가표의 감소대책을 작업 전에 확인한 결과. 회사별로만 저장·조회한다.
  CREATE TABLE IF NOT EXISTS daily_checks (
    id         serial PRIMARY KEY,
    company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    user_id    integer REFERENCES users(id) ON DELETE SET NULL,
    title      text NOT NULL,
    check_date date NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Seoul')::date,
    items      jsonb NOT NULL,
    done_count integer NOT NULL,
    total      integer NOT NULL,
    note       text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS daily_checks_company_idx ON daily_checks(company_id, created_at DESC);
  -- 매일 점검 (11/22): 회사가 매일 점검에 쓸 평가표를 고르고, 점검 기록을 그 평가표와 잇는다
  ALTER TABLE assessment_history ADD COLUMN IF NOT EXISTS daily boolean NOT NULL DEFAULT false;
  ALTER TABLE daily_checks ADD COLUMN IF NOT EXISTS history_id integer REFERENCES assessment_history(id) ON DELETE SET NULL;
  CREATE INDEX IF NOT EXISTS daily_checks_history_idx ON daily_checks(history_id, created_at DESC);

  -- 이메일 인증번호 (가입·직원 초대·비밀번호 찾기). 번호는 해시만 저장하고, 쓰거나 만료되면 다시 쓸 수 없다.
  CREATE TABLE IF NOT EXISTS email_codes (
    id          serial PRIMARY KEY,
    purpose     text NOT NULL CHECK (purpose IN ('register', 'invite', 'reset')),
    email       text NOT NULL,
    code_hash   text NOT NULL,
    payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
    company_id  integer REFERENCES companies(id) ON DELETE CASCADE,
    attempts    integer NOT NULL DEFAULT 0,
    expires_at  timestamptz NOT NULL,
    used_at     timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS email_codes_lookup_idx ON email_codes(email, purpose, created_at DESC);
  CREATE INDEX IF NOT EXISTS email_codes_company_idx ON email_codes(company_id) WHERE company_id IS NOT NULL;

  -- AI 초안 작업 (배포 사이트용). Netlify는 약 10초 안에 끝나야 해서, 작업을 여기 적고 Supabase Edge Function이
  -- 뒤에서 AI를 불러 결과를 채운다 (supabase/functions/ai-draft). 토큰은 해시만 저장한다. 하루 지난 작업은 지운다.
  CREATE TABLE IF NOT EXISTS ai_jobs (
    id          text PRIMARY KEY,
    company_id  integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    user_id     integer REFERENCES users(id) ON DELETE SET NULL,
    token_hash  text NOT NULL,
    description text NOT NULL,
    reference   text NOT NULL,
    fallback    jsonb NOT NULL,
    status      text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
    result      jsonb,
    error       text,
    saved       boolean NOT NULL DEFAULT false,
    created_at  timestamptz NOT NULL DEFAULT now(),
    started_at  timestamptz,
    finished_at timestamptz
  );
  CREATE INDEX IF NOT EXISTS ai_jobs_created_idx ON ai_jobs(created_at);
  -- 작업 종류: draft(평가표 초안) / translate(외국인 근로자용 번역, payload에 언어와 쉬운 한국어 요약)
  ALTER TABLE ai_jobs ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'draft';
  ALTER TABLE ai_jobs ADD COLUMN IF NOT EXISTS payload jsonb;

  ALTER TABLE ai_jobs ENABLE ROW LEVEL SECURITY;
  ALTER TABLE email_codes ENABLE ROW LEVEL SECURITY;
  ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
  ALTER TABLE users ENABLE ROW LEVEL SECURITY;
  ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
  ALTER TABLE assessment_history ENABLE ROW LEVEL SECURITY;
  ALTER TABLE nts_attempts ENABLE ROW LEVEL SECURITY;
  ALTER TABLE daily_checks ENABLE ROW LEVEL SECURITY;
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
