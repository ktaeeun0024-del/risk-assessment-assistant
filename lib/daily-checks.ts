// 작업 전 점검 기록 (11/24). 모든 쿼리는 로그인 세션의 회사 ID로 묶는다 (요청에서 회사 번호를 받지 않는다).
import type { CheckItem } from "./checklist";
import { db } from "./db";
import type { RiskLevel } from "./schema";

export type SavedCheckItem = Pick<CheckItem, "action" | "task" | "hazard" | "level"> & { done: boolean };

export type DailyCheck = {
  id: number;
  title: string;
  checkDate: string; // YYYY-MM-DD (한국 날짜)
  doneCount: number;
  total: number;
  note: string;
  author: string;
  createdAt: string;
};

const LEVELS: RiskLevel[] = ["높음", "보통", "낮음"];
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

// 화면이 보낸 점검 결과에서 필요한 칸만 꺼낸다 (길이 제한). 형식이 틀리면 null.
export function readCheck(body: unknown): { title: string; items: SavedCheckItem[]; note: string } | null {
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
  return { title: str(b.title, 200) || "작업", items, note: str(b.note, 500) };
}

export async function saveCheck(
  companyId: number,
  userId: number,
  check: { title: string; items: SavedCheckItem[]; note: string },
): Promise<void> {
  const pool = await db();
  await pool.query(
    `INSERT INTO daily_checks (company_id, user_id, title, items, done_count, total, note)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      companyId,
      userId,
      check.title,
      JSON.stringify(check.items),
      check.items.filter((it) => it.done).length,
      check.items.length,
      check.note,
    ],
  );
}

export async function recentChecks(companyId: number, limit = 10): Promise<DailyCheck[]> {
  const pool = await db();
  const { rows } = await pool.query(
    `SELECT c.id, c.title, to_char(c.check_date, 'YYYY-MM-DD') AS "checkDate", c.done_count AS "doneCount", c.total,
            c.note, COALESCE(u.name, '(삭제된 계정)') AS author, c.created_at AS "createdAt"
       FROM daily_checks c
       LEFT JOIN users u ON u.id = c.user_id
      WHERE c.company_id = $1
      ORDER BY c.created_at DESC, c.id DESC
      LIMIT $2`,
    [companyId, limit],
  );
  return rows.map((r) => ({ ...r, createdAt: new Date(r.createdAt).toISOString() }));
}
