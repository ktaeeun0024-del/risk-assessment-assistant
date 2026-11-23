// 체험 계정 (11/23): 포스터 QR로 들어온 사람이 가입 없이 회사 기능(기록·매일 점검·점검 기록·번역)을 둘러보게 한다.
// - '체험 계정으로 둘러보기'를 누르면 체험 회사의 공용 계정으로 로그인된다. 비밀번호가 없어 다른 방법으로는 로그인할 수 없다.
// - 체험 회사에는 미리 만든 AI 평가표 2개(data/demo_assessments.json, npm run data:demo)와 2주치 점검 기록을 넣어 둔다.
// - 여러 방문자가 같은 회사를 함께 쓰므로, 날이 바뀐 뒤 처음 들어올 때 처음 상태로 되돌린다.
// - 비밀번호 변경·직원 관리는 막는다(forbidDemo). AI 사용 횟수는 막지 않는다 (11/23 팀 크레딧, 다 쓰면 무료 모델로 넘어감).
import seed from "@/data/demo_assessments.json";
import { buildChecklist } from "./checklist";
import { transaction } from "./db";
import type { Assessment, ValidationReport } from "./schema";
import type { PoolClient } from "pg";

const DEMO_EMAIL = "demo@banjangnote.invalid"; // 메일이 갈 수 없는 주소 (.invalid)
const DEMO_COMPANY = "체험 회사 (반장노트)";
const DEMO_NAME = "체험 반장";
const LOCK_KEY = 2026112301; // 동시에 여러 사람이 처음 들어와도 한 번만 준비하게

type Seed = { description: string; mode: string; model: string; assessment: Assessment; report: ValidationReport };
const SEEDS = seed as Seed[];

// 점검 기록 예시: 최근 몇 번째 점검(0 = 가장 최근)에서 어떤 확인 항목(체크리스트 순서)을 못 했는지와 특이사항.
// '자주 못 하는 대책' 알림(최근 10번 중 3번 이상)이 보이도록 평가표마다 한 대책을 여러 번 못 한 것으로 둔다.
const MISSES: Record<number, number>[] = [
  { 0: 1, 2: 1, 4: 5, 6: 1, 9: 1 },
  { 1: 2, 4: 2, 7: 2 },
];
const NOTES: Record<number, string>[] = [
  { 2: "프레스 2호기 방호장치 센서 점검 요청함", 6: "신규 작업자 1명, 작업 전 교육 후 투입" },
  { 4: "비 와서 출하장 바닥 미끄러움. 걸레질 후 작업", 7: "화물차 발판 아직 없음. 구매 요청함" },
];
const CHECKS = 11; // 평가표마다 넣을 지난 점검 수 (어제부터 거꾸로, 일요일은 쉰다)

// 어제부터 거꾸로 일요일을 뺀 날짜 CHECKS개 (YYYY-MM-DD, 서울 기준)
function pastWorkdays(): string[] {
  const days: string[] = [];
  const day = new Date(Date.now() + 9 * 3600_000); // UTC 함수로 서울 날짜를 다룬다
  while (days.length < CHECKS) {
    day.setUTCDate(day.getUTCDate() - 1);
    if (day.getUTCDay() !== 0) days.push(day.toISOString().slice(0, 10));
  }
  return days;
}

async function reset(c: PoolClient, companyId: number, userId: number) {
  await c.query(`DELETE FROM daily_checks WHERE company_id = $1`, [companyId]);
  await c.query(`DELETE FROM assessment_history WHERE company_id = $1`, [companyId]);
  await c.query(`DELETE FROM ai_jobs WHERE company_id = $1`, [companyId]);
  await c.query(`DELETE FROM sessions WHERE user_id = $1 AND created_at < now() - interval '1 day'`, [userId]);

  for (const [n, s] of SEEDS.entries()) {
    const { rows } = await c.query(
      `INSERT INTO assessment_history
         (company_id, user_id, title, description, mode, model, item_count, passed, assessment, report, daily, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true, now() - make_interval(days => $11))
       RETURNING id`,
      [companyId, userId, s.assessment.작업명, s.description, s.mode, s.model, s.assessment.항목.length, s.report.ok,
        JSON.stringify(s.assessment), JSON.stringify(s.report), CHECKS + 4 - n],
    );
    const historyId = rows[0]?.id ?? null;
    const list = buildChecklist(s.assessment);
    for (const [k, day] of pastWorkdays().entries()) {
      const miss = MISSES[n]?.[k];
      const items = list.map((it, i) => ({
        action: it.action, task: it.task, hazard: it.hazard, level: it.level,
        done: miss === undefined || i !== Math.min(miss, list.length - 1),
      }));
      await c.query(
        `INSERT INTO daily_checks (company_id, user_id, history_id, title, check_date, items, done_count, total, note, created_at)
         VALUES ($1, $2, $3, $4, $5::date, $6, $7, $8, $9, ($5::date + time '07:40' + make_interval(mins => $10)) AT TIME ZONE 'Asia/Seoul')`,
        [companyId, userId, historyId, s.assessment.작업명, day, JSON.stringify(items),
          items.filter((it) => it.done).length, items.length, NOTES[n]?.[k] ?? "", n * 15 + (k % 4) * 3],
      );
    }
  }
  await c.query(
    `UPDATE companies SET status = 'approved', demo_day = (now() AT TIME ZONE 'Asia/Seoul')::date WHERE id = $1`,
    [companyId],
  );
}

// 체험 회사와 계정을 준비하고(없으면 만들고, 날이 바뀌었으면 처음 상태로) 계정 번호를 돌려준다
export async function enterDemo(): Promise<number> {
  return transaction(async (c) => {
    await c.query(`SELECT pg_advisory_xact_lock($1)`, [LOCK_KEY]);
    let { rows } = await c.query(
      `SELECT c.id, u.id AS "userId", c.demo_day = (now() AT TIME ZONE 'Asia/Seoul')::date AS fresh
         FROM companies c LEFT JOIN users u ON u.company_id = c.id AND u.email = $1
        WHERE c.is_demo ORDER BY c.id LIMIT 1`,
      [DEMO_EMAIL],
    );
    let companyId: number = rows[0]?.id;
    let userId: number | undefined = rows[0]?.userId ?? undefined;
    const fresh = rows[0]?.fresh === true && !!userId; // 오늘 이미 처음 상태로 되돌렸음
    if (!companyId) {
      ({ rows } = await c.query(
        `INSERT INTO companies (name, status, is_demo, reviewed_at, reviewed_by) VALUES ($1, 'approved', true, now(), 'demo') RETURNING id`,
        [DEMO_COMPANY],
      ));
      companyId = rows[0].id;
    }
    if (!userId) {
      // 비밀번호 칸에는 scrypt 형식이 아닌 값을 넣어 비밀번호로는 절대 로그인할 수 없게 한다
      ({ rows } = await c.query(
        `INSERT INTO users (company_id, email, name, password_hash, role) VALUES ($1, $2, $3, 'demo-no-password', 'member')
         ON CONFLICT (email) DO UPDATE SET company_id = EXCLUDED.company_id RETURNING id`,
        [companyId, DEMO_EMAIL, DEMO_NAME],
      ));
      userId = rows[0].id as number;
    }
    if (!fresh) await reset(c, companyId, userId);
    return userId;
  });
}
