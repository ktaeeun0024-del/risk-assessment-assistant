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
// 기본은 무료 모델 중 하나를 골라 쓰는 openrouter/free. 검증 측정처럼 결과를 비교해야 할 때는
// OPENROUTER_MODEL에 무료 모델 하나를 이름으로 고정한다 (예: 모델ID:free)
const MODEL = process.env.OPENROUTER_MODEL?.trim() || "openrouter/free";
const TIMEOUT_MS = 90_000;
export const PROMPT_VERSION = "draft-v1-openrouter";

const SYSTEM_PROMPT = `너는 50인 미만 제조 사업장의 위험성평가를 돕는 산업안전 전문가야.
사용자는 안전 담당자가 없는 현장의 반장이나 사업주이고, 작업 내용을 말로 설명해.
그 설명으로 안전보건공단 KRAS 양식의 위험성평가표 초안을 한국어로 작성해.

작성 방법
1. 작업을 세부작업(준비, 본작업, 정리·운반 등)으로 나누고 세부작업마다 유해·위험요인을 찾아.
2. 유해·위험요인은 "무엇 때문에 → 어떤 사고가 난다"가 드러나는 한 문장으로 써.
   예: "프레스 금형 사이에 손을 넣은 상태에서 슬라이드가 내려와 손가락이 끼임"
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
   같은 위험요인을 두 번 쓰지 마. 보통 8~15개 항목이 적당해.
10. 설명에 없는 사실(인원, 설비, 물질)을 지어내지 마.

다른 설명 없이 아래 형태의 JSON 하나만 답해. 숫자 칸에는 1, 2, 3 중 하나의 숫자만 써.
{"작업명":"...","항목":[{"세부작업":"...","분류":"기계적 요인","원인":"...","유해위험요인":"...","관련근거":"","현재조치":"","가능성":2,"중대성":3,"감소대책":["...","..."],"개선후가능성":1,"개선후중대성":3}]}`;

const FORMAT_RETRY =
  '형식이 올바르지 않아. 다른 말 없이 {"작업명":"...","항목":[...]} 형태의 JSON 하나만 다시 답해.';

type Message = { role: "system" | "user" | "assistant"; content: string };

// 사람이 읽을 메시지와 HTTP 상태를 함께 담는 오류
export class DraftError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function callOpenRouter(apiKey: string, messages: Message[]): Promise<{ content: string; model: string }> {
  let res: Response;
  try {
    res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "X-Title": "risk-assessment-assistant",
      },
      body: JSON.stringify({ model: MODEL, messages, temperature: 0.2 }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
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
  const data = await res.json().catch(() => null);
  return {
    content: String(data?.choices?.[0]?.message?.content ?? ""),
    model: String(data?.model ?? MODEL),
  };
}

const toScore = (v: unknown): number => {
  const n = Number(String(v ?? "").match(/[1-3]/)?.[0]);
  return n >= 1 && n <= 3 ? n : NaN;
};
const toText = (v: unknown) => (typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim());

// 모델 답에서 JSON을 꺼내 평가표 모양으로 맞춘다. 형식이 틀리면 null.
// (분류 표기·숫자 문자열처럼 뜻이 분명한 것만 고치고, 내용은 검사기가 판단한다)
export function parseAssessment(content: string): Assessment | null {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  let data: unknown;
  try {
    data = JSON.parse(content.slice(start, end + 1));
  } catch {
    return null;
  }
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

export async function aiDraft(apiKey: string, description: string, reference: string): Promise<AiDraft> {
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

  let attempts = 0;
  let lastModel = MODEL;
  // 최대 3번 호출: 처음 + (형식 오류 재요청 또는 검사 오류 수정)
  let assessment: Assessment | null = null;
  let report: ValidationReport | null = null;
  let formatRetried = false;
  let repaired = false;
  while (attempts < 3) {
    attempts++;
    const { content, model } = await callOpenRouter(apiKey, messages);
    lastModel = model;
    const parsed = parseAssessment(content);
    if (!parsed) {
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
