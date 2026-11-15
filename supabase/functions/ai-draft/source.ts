// Supabase Edge Function: AI 초안을 뒤에서(백그라운드로) 만든다.
//
// 왜: Netlify 무료 서버 함수는 약 10초 안에 끝나야 하는데, 무료 AI는 평가표 하나에 60~90초가 걸린다.
// Supabase 무료 Edge Function은 최대 150초까지 돌 수 있다 (supabase.com/docs/guides/functions/limits).
//
// 흐름
//  1) Netlify(/api/assess)가 ai_jobs에 작업을 적고 { jobId, token }으로 이 함수를 부른다
//  2) 이 함수는 토큰이 맞는 '대기' 작업만 '진행 중'으로 바꾸고 바로 202로 답한다
//  3) 뒤에서 lib/ai.ts의 aiDraft로 평가표를 만들어 ai_jobs에 결과(또는 실패 이유)를 적는다
//  4) 화면이 /api/assess?job=...로 결과를 확인하고, Netlify가 회사 기록에 저장한다
//
// 이 파일은 직접 올리지 않는다. `npm run build:edge`가 lib/ai.ts까지 묶어 index.js를 만들고, 그 파일을 배포한다.
// OpenRouter 키는 Supabase 비밀값(OPENROUTER_API_KEY)이 있으면 그것을, 없으면 Netlify가 보낸 머리글을 쓴다.
import postgres from "npm:postgres@3.4.5";
import { aiDraft, DraftError } from "../../../lib/ai";

declare const Deno: { env: { get(name: string): string | undefined }; serve(h: (req: Request) => Promise<Response>): void };
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

// 함수 최대 150초 중 시작·저장할 시간을 빼고 AI에 쓰는 시간
const AI_BUDGET_MS = 135_000;

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 2 });

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function run(jobId: string, apiKey: string, description: string, reference: string) {
  try {
    const ai = await aiDraft(apiKey, description, reference, { deadline: Date.now() + AI_BUDGET_MS });
    await sql`UPDATE ai_jobs SET status = 'done', result = ${sql.json(ai)}, finished_at = now() WHERE id = ${jobId}`;
  } catch (err) {
    const reason = err instanceof DraftError ? err.message : "AI 초안을 만들지 못했어요.";
    if (!(err instanceof DraftError)) console.error("[ai-draft] 알 수 없는 오류");
    await sql`UPDATE ai_jobs SET status = 'failed', error = ${reason}, finished_at = now() WHERE id = ${jobId}`.catch(
      () => console.error("[ai-draft] 실패 기록 저장 실패"),
    );
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST만 받습니다." }, 405);
  const body = (await req.json().catch(() => null)) as { jobId?: unknown; token?: unknown } | null;
  const jobId = typeof body?.jobId === "string" ? body.jobId : "";
  const token = typeof body?.token === "string" ? body.token : "";
  if (!/^[0-9a-f-]{36}$/.test(jobId) || !/^[0-9a-f]{64}$/.test(token)) return json({ error: "잘못된 요청" }, 400);
  const apiKey = Deno.env.get("OPENROUTER_API_KEY") || req.headers.get("x-openrouter-key") || "";
  if (!apiKey) return json({ error: "AI 키 없음" }, 400);

  // 토큰이 맞고 아직 시작하지 않은 작업만 맡는다 (같은 작업을 두 번 돌리지 않음)
  const rows = await sql`
    UPDATE ai_jobs SET status = 'running', started_at = now()
     WHERE id = ${jobId} AND token_hash = ${await sha256Hex(token)} AND status = 'queued'
     RETURNING description, reference`;
  if (!rows.length) return json({ error: "없는 작업" }, 404);

  EdgeRuntime.waitUntil(run(jobId, apiKey, rows[0].description, rows[0].reference));
  return json({ accepted: true }, 202);
});
