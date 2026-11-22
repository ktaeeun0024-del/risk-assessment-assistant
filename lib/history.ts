// 평가표 기록. 모든 쿼리는 회사 ID로 묶는다. 회사 ID는 로그인 세션에서만 가져온다.
import { db } from "./db";
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
  author: string;
  createdAt: string;
  daily: boolean; // 매일 점검에 쓰는 평가표 (11/22)
};

export async function saveHistory(
  companyId: number,
  userId: number,
  item: { description: string; mode: Mode; model: string; assessment: Assessment; report: ValidationReport },
): Promise<void> {
  const pool = await db();
  await pool.query(
    `INSERT INTO assessment_history
       (company_id, user_id, title, description, mode, model, item_count, passed, assessment, report)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      companyId,
      userId,
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

export async function recentHistory(companyId: number, limit = 20): Promise<HistoryItem[]> {
  const pool = await db();
  const { rows } = await pool.query(
    `SELECT h.id, h.title, h.description, h.mode, h.model, h.item_count AS "itemCount", h.passed,
            h.assessment, h.report, COALESCE(u.name, '(삭제된 계정)') AS author, h.created_at AS "createdAt", h.daily
       FROM assessment_history h
       LEFT JOIN users u ON u.id = h.user_id
      WHERE h.company_id = $1
      ORDER BY h.created_at DESC, h.id DESC
      LIMIT $2`,
    [companyId, limit],
  );
  return rows.map((row) => ({ ...row, createdAt: new Date(row.createdAt).toISOString() }));
}

// 매일 점검에 쓸지 정한다. 우리 회사 평가표만 바뀐다 (없거나 다른 회사면 false).
export async function setDaily(companyId: number, id: number, daily: boolean): Promise<boolean> {
  const pool = await db();
  const { rowCount } = await pool.query(`UPDATE assessment_history SET daily = $3 WHERE id = $1 AND company_id = $2`, [
    id,
    companyId,
    daily,
  ]);
  return !!rowCount;
}
