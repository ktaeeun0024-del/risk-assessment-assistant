// 배포 사이트의 AI 작업 (평가표 초안, 외국인 근로자용 번역). 서버에서만 쓴다.
//
// Netlify 무료 서버 함수는 약 10초 안에 끝나야 해서 1~2분 걸리는 무료 AI를 기다릴 수 없다.
// 그래서 AI_JOB_URL(Supabase Edge Function 주소)이 있으면:
//   startJob          → ai_jobs에 작업을 적고 Edge Function을 깨운 뒤 바로 jobId를 돌려준다
//   checkJob          → (평가표 초안) 화면이 몇 초마다 부른다. 끝났으면 회사 기록에 한 번만 저장하고 평가표를 돌려준다
//   checkTranslateJob → (번역·역번역 검사) 끝났으면 결과를 돌려준다 (기록에는 저장하지 않음)
// AI_JOB_URL이 없으면(실습서버 개발) 이 파일을 쓰지 않고 API가 그 자리에서 AI를 기다린다.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { fallbackModelNotice, type AiDraft } from "./ai";
import type { SessionUser } from "./auth";
import { db, dbErrorCode } from "./db";
import { saveHistory } from "./history";
import type { AssessPending, AssessResponse } from "./options";
import type { KoreanSummary, Lang, TranslatedText, TranslationResult } from "./safety-summary";

// Edge Function은 최대 150초. 그보다 오래 '진행 중'이면 함수가 끊긴 것으로 본다.
const STALE_MS = 170_000;

export const jobsEnabled = () => Boolean(process.env.AI_JOB_URL?.trim());

// translate: 1단계 번역 / backcheck: 2단계 역번역 검사 (단계마다 Supabase 함수 실행 시간을 따로 쓴다)
export type JobKind = "draft" | "translate" | "backcheck";
export type TranslatePayload =
  | { step: "translate"; lang: Lang; source: KoreanSummary }
  | { step: "backcheck"; source: KoreanSummary; translated: TranslatedText };

type NewJob =
  // 평가표 초안. fallback: AI가 실패하면 대신 보여 줄 검색 초안 (지금 바로 만들어 둔다)
  | { kind: "draft"; description: string; reference: string; fallback: AssessResponse }
  | { kind: "translate" | "backcheck"; payload: TranslatePayload };

export async function startJob(user: SessionUser, job: NewJob): Promise<AssessPending> {
  const pool = await db();
  const id = randomUUID();
  const token = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  await pool.query("DELETE FROM ai_jobs WHERE created_at < now() - interval '1 day'");
  await pool.query(
    `INSERT INTO ai_jobs (id, company_id, user_id, token_hash, kind, description, reference, fallback, payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    job.kind === "draft"
      ? [id, user.companyId, user.id, tokenHash, "draft", job.description, job.reference, JSON.stringify(job.fallback), null]
      : [id, user.companyId, user.id, tokenHash, job.kind, job.payload.source.title, "", "{}", JSON.stringify(job.payload)],
  );

  let ok = false;
  try {
    const res = await fetch(process.env.AI_JOB_URL!.trim(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Supabase 비밀값에 키를 넣지 않았을 때를 위해 함께 보낸다 (서버끼리 HTTPS)
        "x-openrouter-key": process.env.OPENROUTER_API_KEY ?? "",
      },
      body: JSON.stringify({ jobId: id, token }),
      signal: AbortSignal.timeout(6_000),
    });
    ok = res.status === 202;
    if (!ok) console.error(`[ai-jobs] AI 작업 시작 실패: HTTP ${res.status}`);
  } catch {
    console.error("[ai-jobs] AI 작업 함수에 연결하지 못했습니다.");
  }
  if (!ok) {
    await pool.query(
      "UPDATE ai_jobs SET status = 'failed', error = $2, finished_at = now() WHERE id = $1 AND status = 'queued'",
      [id, "AI 작업을 시작하지 못했어요."],
    );
  }
  return { pending: true, jobId: id };
}

type JobRow = {
  kind: JobKind;
  status: "queued" | "running" | "done" | "failed";
  result: unknown;
  error: string | null;
  fallback: AssessResponse;
  description: string;
  saved: boolean;
  age_ms: number;
};

// 우리 회사 작업만 읽는다. 너무 오래 '진행 중'이면 실패로 바꾼다. 없거나 종류가 다르면 null.
async function readJob(user: SessionUser, id: string, kind: JobKind): Promise<JobRow | null> {
  const pool = await db();
  const { rows } = await pool.query<JobRow>(
    `SELECT kind, status, result, error, fallback, description, saved,
            (extract(epoch FROM now() - created_at) * 1000)::bigint AS age_ms
       FROM ai_jobs WHERE id = $1 AND company_id = $2 AND kind = $3`,
    [id, user.companyId, kind],
  );
  const job = rows[0];
  if (!job) return null;
  if ((job.status === "queued" || job.status === "running") && Number(job.age_ms) >= STALE_MS) {
    await pool.query(
      "UPDATE ai_jobs SET status = 'failed', error = $2, finished_at = now() WHERE id = $1 AND status IN ('queued', 'running')",
      [id, "AI 응답이 너무 오래 걸려요."],
    );
    job.status = "failed";
    job.error = "AI 응답이 너무 오래 걸려요.";
  }
  return job;
}

// 평가표 초안: 끝나지 않았으면 pending, 끝났으면 평가표 (실패하면 검색 초안). 다른 회사의 작업은 null.
export async function checkJob(user: SessionUser, id: string): Promise<AssessPending | AssessResponse | null> {
  const job = await readJob(user, id, "draft");
  if (!job) return null;
  if (job.status === "queued" || job.status === "running") return { pending: true, jobId: id };

  const pool = await db();
  const result: AssessResponse =
    job.status === "done" && job.result
      ? { ...(job.result as AiDraft), mode: "ai", notice: fallbackModelNotice((job.result as AiDraft).model) || undefined }
      : { ...job.fallback, fallback: true, notice: `${job.error ?? "AI 초안을 만들지 못했어요."} 대신 표준모델 검색 초안을 보여 드려요.` };

  // 기록은 한 번만 저장한다 (화면이 여러 번 확인해도 saved를 먼저 차지한 요청만 저장)
  const claim = await pool.query("UPDATE ai_jobs SET saved = true WHERE id = $1 AND saved = false RETURNING id", [id]);
  if (claim.rowCount) {
    try {
      await saveHistory(user.companyId, user.id, {
        description: job.description,
        mode: result.mode,
        model: result.model,
        assessment: result.assessment,
        report: result.report,
      });
      result.saved = true;
    } catch (err) {
      console.error(`[ai-jobs] 기록 저장 실패: ${dbErrorCode(err)}`);
      await pool.query("UPDATE ai_jobs SET saved = false WHERE id = $1", [id]).catch(() => undefined);
      result.notice = [result.notice, "평가표를 회사 기록에 저장하지 못했어요."].filter(Boolean).join(" ");
    }
  } else {
    result.saved = true;
  }
  return result;
}

// 번역·역번역 검사: 끝나지 않았으면 pending, 끝났으면 결과, 실패하면 { error }
export async function checkTranslateJob(
  user: SessionUser,
  id: string,
  kind: "translate" | "backcheck",
): Promise<AssessPending | TranslatedText | TranslationResult | { error: string } | null> {
  const job = await readJob(user, id, kind);
  if (!job) return null;
  if (job.status === "queued" || job.status === "running") return { pending: true, jobId: id };
  if (job.status === "done" && job.result) return job.result as TranslatedText | TranslationResult;
  return { error: job.error ?? (kind === "translate" ? "번역을 만들지 못했어요." : "역번역 검사를 하지 못했어요.") };
}
