// 외국인 근로자용 안전 요약 번역 (AI ④). 두 단계로 나눠 부른다.
//   POST /api/translate { assessment, lang }                          → 1단계 번역 (TranslatedText)
//   POST /api/translate { assessment, step: "check", translated }      → 2단계 역번역 검사 (TranslationResult)
//   배포 사이트에서는 두 단계 모두 202 { pending, jobId }를 먼저 돌려준다
//   GET  /api/translate?job=<jobId>&step=translate|check               → 작성 중이면 202 { pending }, 끝나면 결과
// 쉬운 한국어 요약(원문)은 두 단계 모두 서버가 평가표에서 다시 만든다 (lib/safety-summary.ts).
// 그래서 화면이 원문을 바꿔 보내도 역번역은 서버의 원문과 비교한다. AI는 번역과 역번역만 한다.
// 무료 AI 하루 사용량을 지키려고 로그인한 회사 계정만 쓴다.
import { NextResponse } from "next/server";
import { DraftError } from "@/lib/ai";
import { checkTranslateJob, jobsEnabled, startJob } from "@/lib/ai-jobs";
import { AuthError, authErrorResponse, checkSameOrigin, currentUser } from "@/lib/auth";
import { dbErrorCode } from "@/lib/db";
import { buildKoreanSummary, isLang, type KoreanSummary, type TranslatedText } from "@/lib/safety-summary";
import type { Assessment, AssessmentItem } from "@/lib/schema";
import { backCheck, translateLines } from "@/lib/translate";

export const maxDuration = 300;

const MAX_ITEMS = 40;
const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
const num = (v: unknown) => (typeof v === "number" && v >= 1 && v <= 3 ? v : 1);

// 화면이 보낸 평가표에서 요약에 필요한 칸만 꺼낸다 (길이 제한)
function readAssessment(v: unknown): Assessment | null {
  const a = (typeof v === "object" && v !== null ? v : {}) as { 작업명?: unknown; 항목?: unknown };
  if (!Array.isArray(a.항목) || a.항목.length === 0) return null;
  const 항목 = a.항목.slice(0, MAX_ITEMS).map((raw) => {
    const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
    return {
      세부작업: str(r.세부작업, 200),
      분류: str(r.분류, 40),
      원인: str(r.원인, 300),
      유해위험요인: str(r.유해위험요인, 300),
      관련근거: "",
      현재조치: "",
      가능성: num(r.가능성),
      중대성: num(r.중대성),
      감소대책: Array.isArray(r.감소대책) ? r.감소대책.slice(0, 5).map((m) => str(m, 200)).filter(Boolean) : [],
      개선후가능성: num(r.개선후가능성),
      개선후중대성: num(r.개선후중대성),
    } satisfies AssessmentItem;
  });
  return { 작업명: str(a.작업명, 200) || "작업", 항목 };
}

// 2단계에서 화면이 돌려보낸 1단계 번역문 (줄 수는 서버 원문과 같아야 한다)
function readTranslated(v: unknown, source: KoreanSummary): TranslatedText | null {
  const t = (typeof v === "object" && v !== null ? v : {}) as Record<string, unknown>;
  if (!isLang(t.lang) || !Array.isArray(t.lines) || t.lines.length !== source.lines.length) return null;
  return {
    lang: t.lang,
    title: str(t.title, 300),
    model: str(t.model, 100),
    lines: t.lines.map((l) => {
      const r = (typeof l === "object" && l !== null ? l : {}) as Record<string, unknown>;
      return { risk: str(r.risk, 500), todo: str(r.todo, 600) };
    }),
  };
}

export async function POST(request: Request) {
  let body: { assessment?: unknown; lang?: unknown; step?: unknown; translated?: unknown };
  try {
    checkSameOrigin(request);
    body = await request.json();
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err, "translate");
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }
  const assessment = readAssessment(body?.assessment);
  if (!assessment) return NextResponse.json({ error: "번역할 평가표가 없어요." }, { status: 400 });
  const source = buildKoreanSummary(assessment);
  const step = body?.step === "check" ? "check" : "translate";
  const translated = step === "check" ? readTranslated(body?.translated, source) : null;
  if (step === "translate" && !isLang(body?.lang)) return NextResponse.json({ error: "언어를 다시 골라 주세요." }, { status: 400 });
  if (step === "check" && !translated) return NextResponse.json({ error: "검사할 번역문이 올바르지 않아요." }, { status: 400 });

  let user;
  try {
    user = await currentUser();
  } catch (err) {
    console.error(`[translate] 로그인 확인 실패: ${dbErrorCode(err)}`);
  }
  if (!user || user.mustChangePassword) {
    return NextResponse.json({ error: "번역은 로그인한 회사 계정만 쓸 수 있어요.", code: "LOGIN_REQUIRED" }, { status: 401 });
  }
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "서버에 AI API 키가 설정되지 않았어요." }, { status: 503 });

  if (jobsEnabled()) {
    try {
      const pending =
        step === "translate"
          ? await startJob(user, { kind: "translate", payload: { step: "translate", lang: body.lang as never, source } })
          : await startJob(user, { kind: "backcheck", payload: { step: "backcheck", source, translated: translated! } });
      return NextResponse.json(pending, { status: 202 });
    } catch (err) {
      console.error(`[translate] AI 작업 저장 실패: ${dbErrorCode(err)}`);
      return NextResponse.json({ error: "번역을 시작하지 못했어요. 잠시 후 다시 시도해 주세요." }, { status: 503 });
    }
  }
  try {
    return NextResponse.json(
      step === "translate"
        ? await translateLines(apiKey, source, body.lang as never)
        : await backCheck(apiKey, source, translated!),
    );
  } catch (err) {
    const message = err instanceof DraftError ? err.message : "번역을 만들지 못했어요.";
    return NextResponse.json({ error: message }, { status: err instanceof DraftError ? err.status : 502 });
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get("job") ?? "";
  const kind = url.searchParams.get("step") === "check" ? "backcheck" : "translate";
  if (!/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  try {
    const user = await currentUser();
    if (!user) return NextResponse.json({ error: "로그인이 필요해요.", code: "LOGIN_REQUIRED" }, { status: 401 });
    const job = await checkTranslateJob(user, id, kind);
    if (!job) return NextResponse.json({ error: "작업을 찾지 못했어요." }, { status: 404 });
    if ("error" in job) return NextResponse.json(job, { status: 502 });
    return NextResponse.json(job, { status: "pending" in job ? 202 : 200 });
  } catch (err) {
    console.error(`[translate] 작업 확인 실패: ${dbErrorCode(err)}`);
    return NextResponse.json({ error: "결과를 확인하지 못했어요. 잠시 후 다시 시도해 주세요." }, { status: 503 });
  }
}
