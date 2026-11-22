// 작업 전 점검 기록 (11/21, 11/22 매일 점검). 모든 쿼리는 로그인 세션의 회사 ID로 묶는다 (요청에서 회사 번호를 받지 않는다).
//   - 저장: 점검 결과 한 번 = 한 줄. 어느 평가표로 점검했는지(history_id)를 잇는다 (우리 회사 평가표일 때만)
//   - 오늘의 점검: 회사가 '매일 점검에 쓰기'로 고른 평가표마다 오늘(서울 날짜) 점검했는지
//   - 자주 못 하는 대책: 같은 평가표의 최근 점검 10번 중 3번 이상 확인 못 한 대책 → 평가표를 고칠 신호
//   - CSV: 한 달치 점검을 대책 한 줄씩 (엑셀에서 보관·제출용)
import type { CheckItem } from "./checklist";
import { db } from "./db";
import type { Assessment, RiskLevel } from "./schema";

export type SavedCheckItem = Pick<CheckItem, "action" | "task" | "hazard" | "level"> & { done: boolean };

export type DailyCheck = {
  id: number;
  historyId: number | null;
  title: string;
  checkDate: string; // YYYY-MM-DD (한국 날짜)
  doneCount: number;
  total: number;
  note: string;
  author: string;
  createdAt: string;
};

export type DailyCheckDetail = DailyCheck & { items: SavedCheckItem[] };

export type TodayItem = {
  historyId: number;
  title: string;
  description: string;
  assessment: Assessment;
  today: { doneCount: number; total: number; author: string; createdAt: string } | null;
};

export type Miss = { action: string; count: number; of: number };

export const MISS_WINDOW = 10; // 최근 몇 번의 점검을 볼지
export const MISS_MIN = 3; // 몇 번 이상 못 했으면 알릴지

const LEVELS: RiskLevel[] = ["높음", "보통", "낮음"];
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const SEOUL_TODAY = "(now() AT TIME ZONE 'Asia/Seoul')::date";

const CHECK_COLUMNS = `c.id, c.history_id AS "historyId", c.title, to_char(c.check_date, 'YYYY-MM-DD') AS "checkDate",
  c.done_count AS "doneCount", c.total, c.note, COALESCE(u.name, '(삭제된 계정)') AS author, c.created_at AS "createdAt"`;

const toCheck = <T extends { createdAt: string | Date }>(r: T) => ({ ...r, createdAt: new Date(r.createdAt).toISOString() });

// 화면이 보낸 점검 결과에서 필요한 칸만 꺼낸다 (길이 제한). 형식이 틀리면 null.
export function readCheck(
  body: unknown,
): { historyId: number | null; title: string; items: SavedCheckItem[]; note: string } | null {
  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  if (!Array.isArray(b.items) || b.items.length === 0 || b.items.length > 20) return null;
  const items = b.items.map((raw) => {
    const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
    return {
      action: str(r.action, 300),
      task: str(r.task, 200),
      hazard: str(r.hazard, 300),
      level: (LEVELS as unknown[]).includes(r.level) ? (r.level as RiskLevel) : "보통",
      done: r.done === true,
    };
  });
  if (items.some((it) => !it.action)) return null;
  const historyId = Number.isInteger(b.historyId) && (b.historyId as number) > 0 ? (b.historyId as number) : null;
  return { historyId, title: str(b.title, 200) || "작업", items, note: str(b.note, 500) };
}

export async function saveCheck(
  companyId: number,
  userId: number,
  check: { historyId: number | null; title: string; items: SavedCheckItem[]; note: string },
): Promise<void> {
  const pool = await db();
  // 평가표 번호는 우리 회사 것일 때만 잇는다 (다른 회사 번호를 보내면 연결 없이 저장)
  await pool.query(
    `INSERT INTO daily_checks (company_id, user_id, history_id, title, items, done_count, total, note)
     VALUES ($1, $2, (SELECT id FROM assessment_history WHERE id = $3 AND company_id = $1), $4, $5, $6, $7, $8)`,
    [
      companyId,
      userId,
      check.historyId,
      check.title,
      JSON.stringify(check.items),
      check.items.filter((it) => it.done).length,
      check.items.length,
      check.note,
    ],
  );
}

export async function recentChecks(companyId: number, opts: { limit?: number; historyId?: number } = {}): Promise<DailyCheck[]> {
  const pool = await db();
  const { rows } = await pool.query(
    `SELECT ${CHECK_COLUMNS}
       FROM daily_checks c
       LEFT JOIN users u ON u.id = c.user_id
      WHERE c.company_id = $1 AND ($2::int IS NULL OR c.history_id = $2)
      ORDER BY c.created_at DESC, c.id DESC
      LIMIT $3`,
    [companyId, opts.historyId ?? null, opts.limit ?? 20],
  );
  return rows.map(toCheck);
}

export async function checkDetail(companyId: number, id: number): Promise<DailyCheckDetail | null> {
  const pool = await db();
  const { rows } = await pool.query(
    `SELECT ${CHECK_COLUMNS}, c.items
       FROM daily_checks c
       LEFT JOIN users u ON u.id = c.user_id
      WHERE c.company_id = $1 AND c.id = $2`,
    [companyId, id],
  );
  return rows[0] ? toCheck(rows[0]) : null;
}

// 매일 점검에 쓰는 평가표와 오늘 마지막 점검
export async function todayStatus(companyId: number): Promise<TodayItem[]> {
  const pool = await db();
  const { rows } = await pool.query(
    `SELECT h.id AS "historyId", h.title, h.description, h.assessment,
            CASE WHEN t.id IS NULL THEN NULL ELSE json_build_object(
              'doneCount', t.done_count, 'total', t.total, 'author', COALESCE(u.name, '(삭제된 계정)'), 'createdAt', t.created_at)
            END AS today
       FROM assessment_history h
       LEFT JOIN LATERAL (
         SELECT id, done_count, total, user_id, created_at FROM daily_checks
          WHERE history_id = h.id AND company_id = $1 AND check_date = ${SEOUL_TODAY}
          ORDER BY created_at DESC LIMIT 1) t ON true
       LEFT JOIN users u ON u.id = t.user_id
      WHERE h.company_id = $1 AND h.daily
      ORDER BY h.created_at DESC`,
    [companyId],
  );
  return rows.map((r) => ({ ...r, today: r.today ? { ...r.today, createdAt: new Date(r.today.createdAt).toISOString() } : null }));
}

// 같은 평가표의 최근 점검 10번 중 3번 이상 확인하지 못한 대책
export async function frequentMisses(companyId: number, historyId: number): Promise<Miss[]> {
  const pool = await db();
  const { rows } = await pool.query(
    `WITH recent AS (
       SELECT items FROM daily_checks
        WHERE company_id = $1 AND history_id = $2
        ORDER BY created_at DESC LIMIT $3)
     SELECT item->>'action' AS action, count(*)::int AS count, (SELECT count(*)::int FROM recent) AS "of"
       FROM recent, jsonb_array_elements(recent.items) AS item
      WHERE (item->>'done')::boolean IS NOT TRUE
      GROUP BY 1 HAVING count(*) >= $4
      ORDER BY 2 DESC, 1
      LIMIT 10`,
    [companyId, historyId, MISS_WINDOW, MISS_MIN],
  );
  return rows;
}

// 한 달치 점검을 대책 한 줄씩 (CSV용). month = 'YYYY-MM'
export async function checksForMonth(companyId: number, month: string): Promise<DailyCheckDetail[]> {
  const pool = await db();
  const { rows } = await pool.query(
    `SELECT ${CHECK_COLUMNS}, c.items
       FROM daily_checks c
       LEFT JOIN users u ON u.id = c.user_id
      WHERE c.company_id = $1 AND to_char(c.check_date, 'YYYY-MM') = $2
      ORDER BY c.check_date, c.created_at`,
    [companyId, month],
  );
  return rows.map(toCheck);
}

// 엑셀에서 수식으로 실행되지 않게 = + - @ 로 시작하는 칸은 앞에 작은따옴표를 붙인다
const cell = (v: unknown) => {
  const s = String(v ?? "");
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
};

export function checksCsv(checks: DailyCheckDetail[]): string {
  const head = ["점검일", "작업명", "점검자", "확인", "확인할 것(감소대책)", "위험성", "위험요인", "세부작업", "특이사항"];
  const lines = [head.map(cell).join(",")];
  for (const c of checks) {
    for (const it of c.items) {
      lines.push(
        [c.checkDate, c.title, c.author, it.done ? "O" : "X", it.action, it.level, it.hazard, it.task, c.note].map(cell).join(","),
      );
    }
  }
  return "﻿" + lines.join("\r\n") + "\r\n";
}
