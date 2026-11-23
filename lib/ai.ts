// AI ①: 작업 설명 → 위험성평가표 초안 (OpenRouter 무료 모델)
//
// 1. 표준모델 검색 결과를 참고 자료로 함께 준다 (근거 있는 내용을 쓰도록)
// 2. AI 답에서 JSON을 꺼내 형식을 맞춘다. 형식이 틀리면 한 번 다시 요청한다.
// 3. 검사기(lib/validator.ts)로 검사하고, 오류가 있으면 오류 목록을 보내 한 번 고쳐 쓰게 한다.
import {
  CATEGORIES,
  LIKELIHOOD,
  SEVERITY,
  normalizeCategory,
  type Assessment,
  type AssessmentItem,
  type ValidationReport,
} from "./schema";
import { validate } from "./validator";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
// 기본 모델: 검증 측정(eval/README.md)에서 고른 무료 모델. 2종 시험에서 위험요인 재현율 41%로
// 후보 3개 중 가장 높았다 (gemma-4-31b는 요청 과다로 실패, nemotron-3.5-super-vl은 19%).
// 다른 모델을 쓰려면 OPENROUTER_MODEL에 이름을 넣는다 ("openrouter/free"는 부를 때마다 모델이 바뀜)
// 11/23: 같은 모델의 유료판으로 바꿈 (팀 OpenRouter 크레딧 사용). 무료판은 멈추거나(가동률 0%) 1건에 105~171초라
// 배포 사이트 제한(135초)을 자주 넘겨 검색 초안으로 바뀌었다. 유료판은 예시 작업 29초, 검사 한 번에 통과.
// 같은 모델이라 검증 숫자(무료판으로 잼)는 그대로 쓴다. 유료판이 안 되면 아래 무료 대체 모델로 넘어간다.
export const DEFAULT_MODEL = "nvidia/nemotron-3-ultra-550b-a55b";
const MODEL = process.env.OPENROUTER_MODEL?.trim() || DEFAULT_MODEL;

// 대체 모델 (11/23): 무료 기본 모델이 멈추는 때가 있다 (11/23 OpenRouter 조회: 최근 30분 가동률 0%, 호출이 5분 넘게 답 없음).
// 그때 멈춘 모델을 2분 넘게 기다리다 검색 초안으로 넘어가지 않도록, 부르기 전에 상태를 보고 살아 있는 무료 모델로 바꾼다.
// 대체 모델은 검증 품질이 낮아(11/15 2종 시험: super-vl 19% vs 기본 41%) 기본 모델이 멈췄을 때만 쓰고 화면에 알린다.
export const FALLBACK_MODELS = ["nvidia/nemotron-3.5-super-vl:free", "nvidia/nemotron-3.5-lightning:free"];
const HEALTH_TTL_MS = 60_000;
const health = new Map<string, { ok: boolean; at: number }>();

// OpenRouter의 모델 상태 (최근 30분 가동률). 조회에 실패하면 살아 있다고 본다 (조회 때문에 AI를 막지 않게)
async function modelUp(apiKey: string, model: string): Promise<boolean> {
  const hit = health.get(model);
  if (hit && Date.now() - hit.at < HEALTH_TTL_MS) return hit.ok;
  let ok = true;
  try {
    const res = await fetch(`https://openrouter.ai/api/v1/models/${model}/endpoints`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(3_000),
    });
    if (res.ok) {
      const endpoints: { status?: number; uptime_last_30m?: number | null }[] = (await res.json())?.data?.endpoints ?? [];
      ok = endpoints.some((e) => (e.status ?? 0) >= 0 && (e.uptime_last_30m == null || e.uptime_last_30m >= 50));
    }
  } catch {
    ok = true;
  }
  health.set(model, { ok, at: Date.now() });
  return ok;
}

// 부를 모델 고르기: 기본 모델이 살아 있으면 기본 모델, 멈췄으면 살아 있는 첫 대체 모델
export async function pickModel(apiKey: string, preferred = MODEL): Promise<string> {
  if (await modelUp(apiKey, preferred)) return preferred;
  for (const m of FALLBACK_MODELS) if (m !== preferred && (await modelUp(apiKey, m))) return m;
  return preferred;
}

const base = (m: string) => m.replace(/:free$/, "");
// 대체 모델로 만들었으면 화면에 보여 줄 안내 (기본 모델이면 빈 문자열)
export function fallbackModelNotice(model: string): string {
  return model && base(model) !== base(MODEL) && FALLBACK_MODELS.some((m) => base(m) === base(model))
    ? "기본 AI 모델이 지금 멈춰 있어 대체 무료 모델로 만들었어요. 기본 모델보다 위험요인을 덜 찾을 수 있으니 더 꼼꼼히 확인해 주세요."
    : "";
}
// 배포 사이트의 서버 실행 시간 제한(Netlify 무료는 약 10초)보다 짧게 AI_TIMEOUT_MS를 주면
// 시간 안에 AI를 포기하고 검색 초안으로 넘어간다. 기본 90초.
const TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS) > 0 ? Number(process.env.AI_TIMEOUT_MS) : 90_000;
// v2 (11/17): 20종 검증에서 드러난 문제를 고침 — 설명에 없는 설비 지어내기, 원인 없이 결과만 쓴 문장,
// 자주 놓친 관리적 원인(보호구·혼자 작업·신호수), 형식 오류(코드 블록·설명 덧붙이기)
// v3 (11/17): v2에서 관리 문제를 사고 없이 따로 쓴 줄('단독 작업으로 초기 대응 지연')이 생겨 사고와 묶어 쓰게 함,
// 약품 이름 지어내기 금지, 한자·일본어 금지. 항목 10~13개·대책 1~2개로 답 길이를 줄여 시간 제한 안에 끝나게.
// ('40자 안팎으로 짧게'를 넣었더니 E17에서 대상·원인이 빠진 문장만 나와 빼고, 대상·원인 필수를 예와 함께 넣음)
export const PROMPT_VERSION = "draft-v3-openrouter";

const SYSTEM_PROMPT = `너는 50인 미만 제조 사업장의 위험성평가를 돕는 산업안전 전문가야.
사용자는 안전 담당자가 없는 현장의 반장이나 사업주이고, 작업 내용을 말로 설명해.
그 설명으로 안전보건공단 KRAS 양식의 위험성평가표 초안을 한국어로 작성해.

가장 중요한 규칙
- 작업 설명에 나온 기계·공구·물질·장소만 다뤄. 설명에 없는 기계·공구·물질은 위험요인에 쓰지 마.
  예: 설명에 그라인더가 없으면 "그라인더 분진"을 쓰지 않는다. 고소작업대·사다리·약품도 설명에 있을 때만 쓴다.
  약품 이름(세척제, 조류제거제 등)도 설명에 없으면 지어내지 마.
  참고 자료에 나온 설비라도 설명에 없으면 쓰지 마.

작성 방법
1. 작업을 세부작업(준비, 본작업, 정리·운반 등)으로 나누고 세부작업마다 유해·위험요인을 찾아.
2. 유해·위험요인은 "무엇 때문에(대상과 원인) → 어떤 사고가 난다"가 드러나는 한 문장으로 써.
   좋은 예: "프레스 금형 사이에 손을 넣은 상태에서 슬라이드가 내려와 손가락이 끼임"
   나쁜 예: "화학물질 접촉·흡입으로 피부염, 중독 발생" (무엇을 하다가 어떻게 닿는지 없이 결과만 나열함)
   한 문장에는 사고 하나만 써. 여러 사고를 쉼표로 늘어놓지 마.
3. 분류는 다음 6가지 중 하나를 글자 그대로 써: ${CATEGORIES.join(", ")}
4. 위험성은 3x3 빈도·강도법으로 판단해.
   - 가능성: ${Object.entries(LIKELIHOOD).map(([k, v]) => `${k}=${v}`).join("; ")}
   - 중대성: ${Object.entries(SEVERITY).map(([k, v]) => `${k}=${v}`).join("; ")}
   - 가능성 x 중대성: 1~2 낮음, 3~4 보통, 6~9 높음
   - 설명에 나온 현재 안전조치를 반영한 지금 상태로 판단해.
5. 감소대책은 현장에서 바로 할 수 있는 구체적인 행동으로 써. 우선순위는
   제거·대체 → 공학적 대책(방호장치, 인터록, 국소배기) → 관리적 대책(작업절차, 교육, 표지) → 보호구 순이야.
   위험성이 보통 이상이면 감소대책을 반드시 1개 이상 써.
6. 개선후가능성·개선후중대성은 감소대책을 모두 이행했을 때 기준이고, 개선 전보다 높을 수 없어.
   중대성은 대책으로 잘 줄지 않으니 보통은 가능성을 낮춰.
7. 관련근거에는 "안전보건규칙 제103조" 같은 형식으로 조항을 써. 확실하지 않으면 빈 문자열로 둬.
   참고 자료에 나온 조항은 써도 되지만, 추측한 조항 번호는 절대 쓰지 마. 틀린 조항은 빈칸보다 해로워.
8. 현재조치는 설명에 나온 내용만 써. 없으면 빈 문자열이야.
9. 설명에 나온 기계·물질·작업 방식에 맞는 위험요인을 우선 찾고, 흔한 위험(넘어짐, 중량물 요통, 소음 등)도 빠뜨리지 마.
   설명에 나온 작업을 할 때 흔한 관리 문제도 원인으로 고려해:
   보호구(안전모·안전대·보안경·장갑) 미착용, 혼자 작업, 신호수·유도원 없음, 작업 전 점검 미흡, 정리정돈 미흡.
   단, 관리 문제만 따로 한 줄로 쓰지 말고 그 때문에 생기는 구체적인 사고와 묶어 써.
   좋은 예: "안전대를 걸지 않고 비계 가장자리에서 작업하다 균형을 잃고 추락"
   나쁜 예: "단독 작업으로 응급상황 시 초기 대응 지연", "보호구 미착용으로 보호 실패" (구체적인 사고가 없음)
   같은 위험요인을 두 번 쓰지 마. 항목은 10~13개, 감소대책은 항목마다 1~2개만 써 (답이 길면 중간에 끊길 수 있어).
   군더더기는 빼되, 유해·위험요인 문장에는 반드시 대상(어떤 기계·도구·작업)과 원인을 넣어.
   나쁜 예: "허리에 무리가 가 요통 발생", "날에 베여 열상 발생" (무엇을 하다가인지 없음)
   좋은 예: "대형 화분을 혼자 들어 옮기다 허리에 무리가 가 요통", "전정기로 높은 가지를 자르다 날에 손이 베임"
10. 설명에 없는 사실(인원, 설비, 물질)을 지어내지 마.

답은 아래 형태의 JSON 하나뿐이어야 해. 앞뒤에 인사말·설명·코드 블록(\`\`\`)을 붙이지 마.
문자열 안에서는 큰따옴표를 쓰지 마(필요하면 작은따옴표). 한글로만 쓰고 한자·일본어를 섞지 마. 숫자 칸에는 1, 2, 3 중 하나의 숫자만 써.
{"작업명":"...","항목":[{"세부작업":"...","분류":"기계적 요인","원인":"...","유해위험요인":"...","관련근거":"","현재조치":"","가능성":2,"중대성":3,"감소대책":["...","..."],"개선후가능성":1,"개선후중대성":3}]}`;

const FORMAT_RETRY =
  '형식이 올바르지 않아. 다른 말 없이 {"작업명":"...","항목":[...]} 형태의 JSON 하나만 다시 답해.';

export type Message = { role: "system" | "user" | "assistant"; content: string };

// 사람이 읽을 메시지와 HTTP 상태를 함께 담는 오류
export class DraftError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

// 번역(lib/translate.ts)에서도 쓴다
export async function callOpenRouter(
  apiKey: string,
  messages: Message[],
  timeoutMs = TIMEOUT_MS,
  model = MODEL,
  // OpenRouter 생각(reasoning) 설정. 번역처럼 깊이 생각할 필요 없는 일은 줄여서 빠르게 한다
  reasoning?: { effort?: "low" | "medium" | "high"; enabled?: boolean; exclude?: boolean },
): Promise<{ content: string; model: string }> {
  let res: Response;
  try {
    res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "X-Title": "risk-assessment-assistant",
      },
      body: JSON.stringify({ model, messages, temperature: 0.2, ...(reasoning ? { reasoning } : {}) }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    console.error(`[assess] OpenRouter 요청 실패: ${timedOut ? "시간 초과" : "네트워크 오류"}`);
    throw timedOut
      ? new DraftError("AI 응답이 너무 오래 걸려요.", 504)
      : new DraftError("AI 서버에 연결하지 못했어요.", 502);
  }
  if (!res.ok) {
    console.error(`[assess] OpenRouter 오류 응답: HTTP ${res.status}`);
    if (res.status === 401 || res.status === 403) throw new DraftError("서버의 AI API 키가 올바르지 않아요.", 500);
    if (res.status === 402) throw new DraftError("AI 사용 한도를 넘었어요.", 503);
    if (res.status === 429) throw new DraftError("지금 AI 요청이 많아요.", 429);
    throw new DraftError("AI가 응답하지 못했어요.", 502);
  }
  // OpenRouter는 답을 다 만들기 전에 응답 머리(200)를 먼저 보낸다. 그래서 시간 제한은 본문을 읽는 도중에 걸린다.
  // 예전에는 이 시간 초과를 삼켜 '빈 답'으로 보였다 (11/18 확인: 빈 답이 모두 호출 120초 뒤에 남)
  let data;
  try {
    data = await res.json();
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    console.error(`[assess] OpenRouter 답 읽기 실패: ${timedOut ? "시간 초과" : "형식 오류"}`);
    if (timedOut) throw new DraftError("AI 응답이 너무 오래 걸려요.", 504);
    data = null;
  }
  const choice = data?.choices?.[0];
  const content = String(choice?.message?.content ?? "");
  if (!content.trim()) {
    // 정말로 내용이 빈 답 (시간 초과는 위에서 따로 처리)
    const reasoning = String(choice?.message?.reasoning ?? "");
    console.error(
      `[assess] 빈 답: 종료 이유 ${choice?.finish_reason ?? "?"}, 생각 ${reasoning.length}자, 토큰 ${JSON.stringify(data?.usage ?? {})}` +
        (data?.error ? `, 오류 ${String(data.error.code ?? "")} ${String(data.error.message ?? "").slice(0, 120)}` : ""),
    );
  }
  return { content, model: String(data?.model ?? model) };
}

const toScore = (v: unknown): number => {
  const n = Number(String(v ?? "").match(/[1-3]/)?.[0]);
  return n >= 1 && n <= 3 ? n : NaN;
};
const toText = (v: unknown) => (typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim());

// 모델 답에서 JSON을 꺼내 평가표 모양으로 맞춘다. 형식이 틀리면 null.
// (분류 표기·숫자 문자열처럼 뜻이 분명한 것만 고치고, 내용은 검사기가 판단한다)
// JSON 문자열을 너그럽게 읽는다: 그대로 → 흔한 실수 고치기(코드 블록, 끝 쉼표, 둥근 따옴표) → 잘린 답이면
// 마지막으로 끝까지 써진 항목까지만 살리기. 내용은 바꾸지 않는다.
export function lenientJson(content: string): unknown {
  const text = content.replace(/```(?:json)?/gi, "");
  const start = text.indexOf("{");
  if (start === -1) return null;
  const tryParse = (t: string) => {
    try {
      return JSON.parse(t);
    } catch {
      return undefined;
    }
  };
  const fix = (t: string) => t.replace(/[\u201C\u201D]/g, '"').replace(/,\s*([}\]])/g, "$1");
  const end = text.lastIndexOf("}");
  if (end > start) {
    const body = text.slice(start, end + 1);
    const ok = tryParse(body) ?? tryParse(fix(body));
    if (ok !== undefined) return ok;
  }
  // 잘린 답: 마지막 '}' 위치마다 배열·객체를 닫아 보며 가장 긴 것을 살린다
  const body = fix(text.slice(start));
  for (let i = body.lastIndexOf("}"); i > 0; i = body.lastIndexOf("}", i - 1)) {
    const ok = tryParse(body.slice(0, i + 1) + "]}");
    if (ok !== undefined) return ok;
  }
  return null;
}

export function parseAssessment(content: string): Assessment | null {
  const data = lenientJson(content);
  if (!data) return null;
  const obj = data as { 작업명?: unknown; 항목?: unknown };
  if (!obj || !Array.isArray(obj.항목)) return null;
  const items: AssessmentItem[] = obj.항목.map((raw) => {
    const r = (raw ?? {}) as Record<string, unknown>;
    const 분류 = toText(r.분류);
    const ms = Array.isArray(r.감소대책) ? r.감소대책 : toText(r.감소대책) ? [r.감소대책] : [];
    return {
      세부작업: toText(r.세부작업),
      분류: (CATEGORIES as readonly string[]).includes(분류) ? 분류 : normalizeCategory(분류) || 분류,
      원인: toText(r.원인),
      유해위험요인: toText(r.유해위험요인),
      관련근거: toText(r.관련근거),
      현재조치: toText(r.현재조치),
      가능성: toScore(r.가능성),
      중대성: toScore(r.중대성),
      감소대책: ms.map(toText).filter(Boolean),
      개선후가능성: toScore(r.개선후가능성),
      개선후중대성: toScore(r.개선후중대성),
    };
  });
  return { 작업명: toText(obj.작업명) || "작업", 항목: items };
}

export type AiDraft = {
  assessment: Assessment;
  report: ValidationReport;
  model: string;
  attempts: number;
};

// 다시 부르려면 최소 이만큼은 남아 있어야 한다 (무료 모델 1번에 보통 60~90초)
const MIN_RETRY_MS = 50_000;

export type DraftOptions = {
  // 이 시각(Date.now() 기준 ms)까지 끝내야 한다. 정하면 호출마다 남은 시간만큼만 기다리고,
  // 남은 시간이 모자라면 다시 부르지 않고 그때까지의 결과를 돌려준다 (Supabase 함수는 최대 150초).
  deadline?: number;
  // 형식이 틀린 원래 답을 받아 본다 (검증 측정에서 원인을 보려고 파일로 남길 때)
  onFormatError?: (content: string) => void;
  // 모델이 생각하는 양 (없으면 DRAFT_REASONING_EFFORT 환경변수, 그것도 없으면 모델 기본값)
  // "none"은 생각을 끈다 (11/23: 대체 모델이 생각을 켜면 135초 안에 끝내지 못함)
  effort?: "none" | "low" | "medium" | "high";
  // false면 대체 모델로 바꾸지 않는다 (검증 측정은 정한 모델 하나로만 잰다)
  fallback?: boolean;
};
// 마감이 있을 때 대체 모델 몫으로 남겨 두는 시간. 기본 모델이 이 시간을 남기고도 답이 없으면 대체 모델로 넘어간다
// (11/23 시험: 대체 모델은 생각을 끄면 10개 작업 평균 11초, 가장 길게 17초)
const FALLBACK_RESERVE_MS = 25_000;
const DRAFT_EFFORT = ((): DraftOptions["effort"] => {
  const v = process.env.DRAFT_REASONING_EFFORT?.trim();
  return v === "none" || v === "low" || v === "medium" || v === "high" ? v : undefined;
})();

export async function aiDraft(
  apiKey: string,
  description: string,
  reference: string,
  opts: DraftOptions = {},
): Promise<AiDraft> {
  const messages: Message[] = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content:
        `다음 작업 설명으로 위험성평가표 초안을 작성해.\n\n<작업설명>\n${description}\n</작업설명>` +
        (reference
          ? `\n\n<참고자료 설명="공공 위험성평가 표준모델에서 비슷한 작업을 찾은 결과. 설명과 맞는 것만 골라 고쳐 쓰고, 맞지 않으면 무시해">\n${reference}\n</참고자료>`
          : ""),
    },
  ];

  const canFallback = opts.fallback !== false;
  let model = canFallback ? await pickModel(apiKey) : MODEL;
  let attempts = 0;
  let lastModel = model;
  // 최대 3번 호출: 처음 + (형식 오류 재요청 또는 검사 오류 수정)
  let assessment: Assessment | null = null;
  let report: ValidationReport | null = null;
  let formatRetried = false;
  let repaired = false;
  // 기본 모델이 실패했을 때 대체 모델로 바꾼다 (처음 평가표를 받기 전에만, 한 번만)
  const switchToFallback = async (why: string): Promise<boolean> => {
    if (!canFallback || assessment || model !== MODEL) return false;
    for (const m of FALLBACK_MODELS) {
      if (m !== MODEL && (await modelUp(apiKey, m))) {
        console.error(`[assess] 기본 모델이 ${why} 대체 모델로 다시 요청합니다.`);
        model = m;
        return true;
      }
    }
    return false;
  };
  while (attempts < 3) {
    const left = opts.deadline ? opts.deadline - Date.now() : TIMEOUT_MS;
    const minRetry = model === MODEL ? MIN_RETRY_MS : 15_000; // 대체 모델은 빨라서 짧게 남아도 다시 부른다
    if (attempts > 0 && opts.deadline && left < minRetry) {
      console.error("[assess] 남은 시간이 모자라 다시 요청하지 않습니다.");
      break;
    }
    attempts++;
    // 대체 모델은 생각을 끈다 (11/23 시험: 생각을 켜면 135초 초과, 끄면 7초에 검사 통과)
    const effort = model !== MODEL ? "none" : (opts.effort ?? DRAFT_EFFORT);
    // 마감이 있으면 기본 모델의 첫 호출은 대체 모델 몫을 남기고 끊는다
    const reserve = opts.deadline && canFallback && model === MODEL && !assessment && left - FALLBACK_RESERVE_MS >= 30_000;
    const wait = opts.deadline ? Math.max(left - (reserve ? FALLBACK_RESERVE_MS : 0), 1_000) : TIMEOUT_MS;
    let reply: { content: string; model: string };
    try {
      reply = await callOpenRouter(
        apiKey,
        messages,
        wait,
        model,
        effort === "none" ? { enabled: false } : effort ? { effort } : undefined,
      );
    } catch (err) {
      // 시간 초과는 다시 불러도 또 넘기기 쉽다. 검사 오류 수정 중이었다면 이미 받은 평가표를 그대로 쓴다
      if (err instanceof DraftError && err.status === 504 && assessment) break;
      // 처음 호출에서 기본 모델이 너무 느리거나(남겨 둔 시간 안) 바로 거절하면(요청 과다·서버 오류) 대체 모델로 다시 부른다
      if (err instanceof DraftError && err.status === 504 && reserve && (await switchToFallback("시간 안에 답하지 않아"))) {
        attempts--;
        continue;
      }
      if (err instanceof DraftError && [429, 502, 503].includes(err.status)) {
        if (canFallback) health.set(MODEL, { ok: false, at: Date.now() });
        if (await switchToFallback("응답하지 않아")) {
          attempts--;
          continue;
        }
      }
      throw err;
    }
    const { content } = reply;
    lastModel = reply.model;
    const parsed = parseAssessment(content);
    if (!parsed) {
      opts.onFormatError?.(content);
      if (formatRetried) break;
      formatRetried = true;
      console.error("[assess] 응답 형식 오류, 한 번 다시 요청합니다.");
      messages.push({ role: "assistant", content }, { role: "user", content: FORMAT_RETRY });
      continue;
    }
    assessment = parsed;
    report = validate(parsed);
    if (report.ok || repaired) break;
    repaired = true;
    messages.push(
      { role: "assistant", content: JSON.stringify(parsed) },
      {
        role: "user",
        content:
          "검사기가 아래 오류를 찾았어. 오류를 모두 고친 평가표 전체를 같은 JSON 형식으로 다시 써. " +
          `오류가 없는 항목은 그대로 둬.\n${report.errors.map((e) => `- ${e}`).join("\n")}`,
      },
    );
  }
  if (!assessment || !report) throw new DraftError("AI 답의 형식이 올바르지 않아요.", 502);
  return { assessment, report, model: lastModel, attempts };
}
