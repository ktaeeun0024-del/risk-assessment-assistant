import { Pool } from "pg";
import type { Mode } from "./options";
import type { Assessment, ValidationReport } from "./schema";

export type HistoryItem = {
  id: number;
  title: string;
  description: string;
  mode: Mode;
  model: string;
  itemCount: number;
  passed: boolean;
  assessment: Assessment;
  report: ValidationReport;
  createdAt: string;
};

export type NewHistoryItem = Omit<HistoryItem, "id" | "createdAt" | "title" | "itemCount" | "passed">;

const CREATE_TABLE = `
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
  )`;

// 개발 서버가 코드를 다시 불러와도 연결 풀이 계속 늘어나지 않도록 하나만 만들어 재사용한다.
const globalForDb = globalThis as unknown as {
  pool?: Pool;
  tableReady?: Promise<void>;
};

function getPool(): Pool {
  if (!process.env.DATABASE_URL) {
    throw Object.assign(new Error("DATABASE_URL이 설정되지 않았습니다."), { code: "NO_DATABASE_URL" });
  }
  globalForDb.pool ??= new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5,
    connectionTimeoutMillis: 5_000,
  });
  return globalForDb.pool;
}

// 테이블은 처음 쓸 때 없으면 만든다. 실패하면 다음 요청에서 다시 시도한다.
async function ready(): Promise<Pool> {
  const pool = getPool();
  globalForDb.tableReady ??= pool
    .query(CREATE_TABLE)
    .then(() => undefined)
    .catch((err) => {
      globalForDb.tableReady = undefined;
      throw err;
    });
  await globalForDb.tableReady;
  return pool;
}

export async function saveHistory(item: NewHistoryItem): Promise<void> {
  const pool = await ready();
  await pool.query(
    `INSERT INTO assessment_history
       (title, description, mode, model, item_count, passed, assessment, report)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      item.assessment.작업명,
      item.description,
      item.mode,
      item.model,
      item.assessment.항목.length,
      item.report.ok,
      JSON.stringify(item.assessment),
      JSON.stringify(item.report),
    ],
  );
}

export async function recentHistory(limit = 5): Promise<HistoryItem[]> {
  const pool = await ready();
  const { rows } = await pool.query(
    `SELECT id, title, description, mode, model, item_count AS "itemCount", passed,
            assessment, report, created_at AS "createdAt"
       FROM assessment_history
      ORDER BY created_at DESC, id DESC
      LIMIT $1`,
    [limit],
  );
  return rows.map((row) => ({ ...row, createdAt: new Date(row.createdAt).toISOString() }));
}

// 오류 내용에 접속 정보가 섞일 수 있어 로그에는 오류 코드만 남긴다.
export function dbErrorCode(err: unknown): string {
  return typeof err === "object" && err !== null && "code" in err
    ? String((err as { code: unknown }).code)
    : "unknown";
}
