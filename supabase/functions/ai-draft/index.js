// 자동 생성 파일: 고치지 말고 supabase/functions/ai-draft/source.ts와 lib/ai.ts를 고친 뒤 npm run build:edge
globalThis.process ??= { env: Deno.env.toObject() };

// supabase/functions/ai-draft/source.ts
import postgres from "npm:postgres@3.4.5";

// lib/schema.ts
var CATEGORIES = [
  "기계적 요인",
  "전기적 요인",
  "화학(물질)적 요인",
  "생물학적 요인",
  "작업특성 요인",
  "작업환경 요인"
];
var LIKELIHOOD = {
  1: "낮음(거의 없음)",
  2: "보통(가끔 발생 가능)",
  3: "높음(자주 발생 가능)"
};
var SEVERITY = {
  1: "경미(치료 후 바로 복귀)",
  2: "중간(휴업이 필요한 부상)",
  3: "치명(사망·장해·직업병)"
};
function riskLevel(likelihood, severity) {
  const score = likelihood * severity;
  return score >= 6 ? "높음" : score >= 3 ? "보통" : "낮음";
}
function normalizeCategory(raw) {
  const s = String(raw).replace(/^\d+\.\s*|\s+/g, "");
  const pairs = [
    ["기계", "기계적 요인"],
    ["전기", "전기적 요인"],
    ["화학", "화학(물질)적 요인"],
    ["생물", "생물학적 요인"],
    ["작업특성", "작업특성 요인"],
    ["작업환경", "작업환경 요인"]
  ];
  return pairs.find(([key]) => s.includes(key))?.[1] ?? "";
}
var LAW_PATTERN = /(안전보건규칙|산업안전보건법\s*시행규칙|산업안전보건법\s*시행령|산업안전보건법|산안법)\s*제?\s*(\d+)\s*조/g;
function extractLawRefs(text) {
  const out = [];
  for (const m of String(text ?? "").matchAll(LAW_PATTERN)) {
    const law = m[1].replace(/\s+/g, " ").replace("산안법", "산업안전보건법");
    out.push(`${law} 제${Number(m[2])}조`);
  }
  return [...new Set(out)];
}

// refs:standard-models
var KNOWN_LAW_REFS = /* @__PURE__ */ new Set(["산업안전보건법 시행규칙 제98조", "산업안전보건법 제114조", "산업안전보건법 제115조", "산업안전보건법 제29조", "산업안전보건법 제37조", "산업안전보건법 제385조", "산업안전보건법 제38조", "산업안전보건법 제41조", "안전보건규칙 제101조", "안전보건규칙 제106조", "안전보건규칙 제122조", "안전보건규칙 제123조", "안전보건규칙 제134조", "안전보건규칙 제135조", "안전보건규칙 제137조", "안전보건규칙 제13조", "안전보건규칙 제144조", "안전보건규칙 제146조", "안전보건규칙 제147조", "안전보건규칙 제149조", "안전보건규칙 제14조", "안전보건규칙 제150조", "안전보건규칙 제152조", "안전보건규칙 제163조", "안전보건규칙 제164조", "안전보건규칙 제168조", "안전보건규칙 제169조", "안전보건규칙 제171조", "안전보건규칙 제172조", "안전보건규칙 제173조", "안전보건규칙 제174조", "안전보건규칙 제175조", "안전보건규칙 제177조", "안전보건규칙 제179조", "안전보건규칙 제180조", "안전보건규칙 제181조", "안전보건규칙 제182조", "안전보건규칙 제183조", "안전보건규칙 제186조", "안전보건규칙 제189조", "안전보건규칙 제197조", "안전보건규칙 제198조", "안전보건규칙 제199조", "안전보건규칙 제19조", "안전보건규칙 제200조", "안전보건규칙 제201조", "안전보건규칙 제205조", "안전보건규칙 제206조", "안전보건규칙 제207조", "안전보건규칙 제209조", "안전보건규칙 제20조", "안전보건규칙 제21조", "안전보건규칙 제221조", "안전보건규칙 제225조", "안전보건규칙 제227조", "안전보건규칙 제22조", "안전보건규칙 제231조", "안전보건규칙 제233조", "안전보건규칙 제239조", "안전보건규칙 제241조", "안전보건규칙 제242조", "안전보건규칙 제243조", "안전보건규칙 제244조", "안전보건규칙 제24조", "안전보건규칙 제254조", "안전보건규칙 제300조", "안전보건규칙 제301조", "안전보건규칙 제302조", "안전보건규칙 제303조", "안전보건규칙 제304조", "안전보건규칙 제305조", "안전보건규칙 제306조", "안전보건규칙 제309조", "안전보건규칙 제310조", "안전보건규칙 제311조", "안전보건규칙 제313조", "안전보건규칙 제315조", "안전보건규칙 제316조", "안전보건규칙 제317조", "안전보건규칙 제319조", "안전보건규칙 제32조", "안전보건규칙 제331조", "안전보건규칙 제332조", "안전보건규칙 제335조", "안전보건규칙 제336조", "안전보건규칙 제338조", "안전보건규칙 제339조", "안전보건규칙 제340조", "안전보건규칙 제342조", "안전보건규칙 제343조", "안전보건규칙 제344조", "안전보건규칙 제346조", "안전보건규칙 제35조", "안전보건규칙 제379조", "안전보건규칙 제37조", "안전보건규칙 제385조", "안전보건규칙 제386조", "안전보건규칙 제388조", "안전보건규칙 제38조", "안전보건규칙 제393조", "안전보건규칙 제399조", "안전보건규칙 제39조", "안전보건규칙 제3조", "안전보건규칙 제405조", "안전보건규칙 제406조", "안전보건규칙 제40조", "안전보건규칙 제42조", "안전보건규칙 제43조", "안전보건규칙 제442조", "안전보건규칙 제44조", "안전보건규칙 제450조", "안전보건규칙 제451조", "안전보건규칙 제4조", "안전보건규칙 제50조", "안전보건규칙 제513조", "안전보건규칙 제516조", "안전보건규칙 제518조", "안전보건규칙 제521조", "안전보건규칙 제54조", "안전보건규칙 제55조", "안전보건규칙 제562조", "안전보건규칙 제563조", "안전보건규칙 제566조", "안전보건규칙 제56조", "안전보건규칙 제57조", "안전보건규칙 제59조", "안전보건규칙 제617조", "안전보건규칙 제620조", "안전보건규칙 제643조", "안전보건규칙 제659조", "안전보건규칙 제661조", "안전보건규칙 제662조", "안전보건규칙 제663조", "안전보건규칙 제664조", "안전보건규칙 제666조", "안전보건규칙 제67조", "안전보건규칙 제68조", "안전보건규칙 제72조", "안전보건규칙 제87조", "안전보건규칙 제89조", "안전보건규칙 제8조", "안전보건규칙 제90조", "안전보건규칙 제91조", "안전보건규칙 제92조", "안전보건규칙 제97조", "안전보건규칙 제98조", "안전보건규칙 제99조", "안전보건규칙 제9조"]);

// lib/validator.ts
var REQUIRED_TEXT = ["세부작업", "원인", "유해위험요인"];
var LEVEL_ORDER = { 낮음: 0, 보통: 1, 높음: 2 };
var isScore = (v) => v === 1 || v === 2 || v === 3;
function validate(assessment) {
  const errors = [];
  const warnings = [];
  const items = assessment?.항목 ?? [];
  if (items.length === 0) errors.push("평가 항목이 하나도 없습니다");
  const seen = /* @__PURE__ */ new Set();
  items.forEach((it, i) => {
    const tag = `${i + 1}번 항목`;
    for (const k of REQUIRED_TEXT) {
      if (!String(it[k] ?? "").trim()) errors.push(`${tag}: '${k}'이(가) 비어 있습니다`);
    }
    if (!CATEGORIES.includes(it.분류)) {
      errors.push(`${tag}: 분류 '${it.분류}'은(는) KRAS 6분류가 아닙니다`);
    }
    if (![it.가능성, it.중대성, it.개선후가능성, it.개선후중대성].every(isScore)) {
      errors.push(`${tag}: 가능성·중대성은 1~3 숫자여야 합니다`);
      return;
    }
    const before = riskLevel(it.가능성, it.중대성);
    const after = riskLevel(it.개선후가능성, it.개선후중대성);
    const measures = (it.감소대책 ?? []).filter((m) => String(m).trim());
    if (before !== "낮음" && measures.length === 0) {
      errors.push(`${tag}: 위험성 '${before}'인데 감소대책이 없습니다`);
    }
    if (LEVEL_ORDER[after] > LEVEL_ORDER[before]) {
      errors.push(`${tag}: 개선 후 위험성(${after})이 개선 전(${before})보다 높습니다`);
    }
    if (before === "높음" && after === "높음") {
      warnings.push(`${tag}: 대책 후에도 위험성이 '높음'입니다. 작업 중지나 추가 대책을 검토하세요`);
    }
    if (it.중대성 === 3 && it.개선후중대성 === 3 && it.개선후가능성 >= 2) {
      warnings.push(`${tag}: 치명적 사고 가능성이 남아 있습니다`);
    }
    const refs = extractLawRefs(it.관련근거);
    if (it.관련근거 && refs.length === 0) {
      warnings.push(`${tag}: 관련근거 '${it.관련근거.slice(0, 30)}'에서 법 조항 번호를 찾지 못했습니다`);
    }
    const unknown = refs.filter((r) => !KNOWN_LAW_REFS.has(r));
    if (unknown.length > 0) {
      warnings.push(`${tag}: ${unknown.join(", ")}은(는) 표준모델에 없는 조항입니다. 실제 조문을 확인하세요`);
    }
    const foreign = [it.세부작업, it.원인, it.유해위험요인, ...measures].join(" ").match(/[぀-ヿ一-鿿]/gu);
    if (foreign) {
      warnings.push(`${tag}: 한글이 아닌 글자(${[...new Set(foreign)].join("")})가 섞여 있습니다. 문장을 고쳐 주세요`);
    }
    const key = `${it.세부작업}|${it.유해위험요인}`;
    if (seen.has(key)) warnings.push(`${tag}: 앞 항목과 중복됩니다`);
    seen.add(key);
  });
  return { ok: errors.length === 0, errors, warnings };
}

// lib/ai.ts
var OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
var DEFAULT_MODEL = "nvidia/nemotron-3-ultra-550b-a55b";
var MODEL = process.env.OPENROUTER_MODEL?.trim() || DEFAULT_MODEL;
var FALLBACK_MODELS = [
  `${DEFAULT_MODEL}:free`,
  "nvidia/nemotron-3.5-super-vl:free",
  "nvidia/nemotron-3.5-lightning:free"
];
var FALLBACK_MIN_MS = { [`${DEFAULT_MODEL}:free`]: 7e4 };
var HEALTH_TTL_MS = 6e4;
var DOWN_AFTER_ERROR_MS = 10 * 6e4;
var health = /* @__PURE__ */ new Map();
async function modelUp(apiKey, model) {
  const hit = health.get(model);
  if (hit && Date.now() < hit.until) return hit.ok;
  let ok = true;
  try {
    const res = await fetch(`https://openrouter.ai/api/v1/models/${model}/endpoints`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(3e3)
    });
    if (res.ok) {
      const endpoints = (await res.json())?.data?.endpoints ?? [];
      ok = endpoints.some((e) => (e.status ?? 0) >= 0 && (e.uptime_last_30m == null || e.uptime_last_30m >= 50));
    }
  } catch {
    ok = true;
  }
  health.set(model, { ok, until: Date.now() + HEALTH_TTL_MS });
  return ok;
}
var markDown = (model) => health.set(model, { ok: false, until: Date.now() + DOWN_AFTER_ERROR_MS });
async function nextFallback(apiKey, exclude, timeLeftMs = Infinity) {
  for (const m of FALLBACK_MODELS) {
    if (m === exclude || timeLeftMs < (FALLBACK_MIN_MS[m] ?? 0)) continue;
    if (await modelUp(apiKey, m)) return m;
  }
  return null;
}
async function pickModel(apiKey, preferred = MODEL) {
  if (await modelUp(apiKey, preferred)) return preferred;
  return await nextFallback(apiKey, preferred) ?? preferred;
}
var isRefusal = (err) => err instanceof DraftError && [429, 502, 503].includes(err.status);
async function callWithFallback(apiKey, messages, timeoutMs, reasoning) {
  const model = await pickModel(apiKey);
  try {
    return await callOpenRouter(apiKey, messages, timeoutMs, model, model === MODEL ? reasoning : { enabled: false });
  } catch (err) {
    if (!isRefusal(err)) throw err;
    markDown(model);
    const next = await nextFallback(apiKey, model);
    if (!next) throw err;
    console.error("[ai] 기본 모델을 쓸 수 없어 무료 모델로 다시 요청합니다.");
    return callOpenRouter(apiKey, messages, timeoutMs, next, { enabled: false });
  }
}
var TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS) > 0 ? Number(process.env.AI_TIMEOUT_MS) : 9e4;
var SYSTEM_PROMPT = `너는 50인 미만 제조 사업장의 위험성평가를 돕는 산업안전 전문가야.
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
var FORMAT_RETRY = '형식이 올바르지 않아. 다른 말 없이 {"작업명":"...","항목":[...]} 형태의 JSON 하나만 다시 답해.';
var DraftError = class extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
  status;
};
async function callOpenRouter(apiKey, messages, timeoutMs = TIMEOUT_MS, model = MODEL, reasoning) {
  let res;
  try {
    res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "X-Title": "risk-assessment-assistant"
      },
      body: JSON.stringify({ model, messages, temperature: 0.2, ...reasoning ? { reasoning } : {} }),
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    console.error(`[assess] OpenRouter 요청 실패: ${timedOut ? "시간 초과" : "네트워크 오류"}`);
    throw timedOut ? new DraftError("AI 응답이 너무 오래 걸려요.", 504) : new DraftError("AI 서버에 연결하지 못했어요.", 502);
  }
  if (!res.ok) {
    console.error(`[assess] OpenRouter 오류 응답: HTTP ${res.status}`);
    if (res.status === 401 || res.status === 403) throw new DraftError("서버의 AI API 키가 올바르지 않아요.", 500);
    if (res.status === 402) throw new DraftError("AI 사용 한도를 넘었어요.", 503);
    if (res.status === 429) throw new DraftError("지금 AI 요청이 많아요.", 429);
    throw new DraftError("AI가 응답하지 못했어요.", 502);
  }
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
    const reasoning2 = String(choice?.message?.reasoning ?? "");
    console.error(
      `[assess] 빈 답: 종료 이유 ${choice?.finish_reason ?? "?"}, 생각 ${reasoning2.length}자, 토큰 ${JSON.stringify(data?.usage ?? {})}` + (data?.error ? `, 오류 ${String(data.error.code ?? "")} ${String(data.error.message ?? "").slice(0, 120)}` : "")
    );
  }
  return { content, model: String(data?.model ?? model) };
}
var toScore = (v) => {
  const n = Number(String(v ?? "").match(/[1-3]/)?.[0]);
  return n >= 1 && n <= 3 ? n : NaN;
};
var toText = (v) => typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
function lenientJson(content) {
  const text = content.replace(/```(?:json)?/gi, "");
  const start = text.indexOf("{");
  if (start === -1) return null;
  const tryParse = (t) => {
    try {
      return JSON.parse(t);
    } catch {
      return void 0;
    }
  };
  const fix = (t) => t.replace(/[\u201C\u201D]/g, '"').replace(/,\s*([}\]])/g, "$1");
  const end = text.lastIndexOf("}");
  if (end > start) {
    const body2 = text.slice(start, end + 1);
    const ok = tryParse(body2) ?? tryParse(fix(body2));
    if (ok !== void 0) return ok;
  }
  const body = fix(text.slice(start));
  for (let i = body.lastIndexOf("}"); i > 0; i = body.lastIndexOf("}", i - 1)) {
    const ok = tryParse(body.slice(0, i + 1) + "]}");
    if (ok !== void 0) return ok;
  }
  return null;
}
function parseAssessment(content) {
  const data = lenientJson(content);
  if (!data) return null;
  const obj = data;
  if (!obj || !Array.isArray(obj.항목)) return null;
  const items = obj.항목.map((raw) => {
    const r = raw ?? {};
    const 분류 = toText(r.분류);
    const ms = Array.isArray(r.감소대책) ? r.감소대책 : toText(r.감소대책) ? [r.감소대책] : [];
    return {
      세부작업: toText(r.세부작업),
      분류: CATEGORIES.includes(분류) ? 분류 : normalizeCategory(분류) || 분류,
      원인: toText(r.원인),
      유해위험요인: toText(r.유해위험요인),
      관련근거: toText(r.관련근거),
      현재조치: toText(r.현재조치),
      가능성: toScore(r.가능성),
      중대성: toScore(r.중대성),
      감소대책: ms.map(toText).filter(Boolean),
      개선후가능성: toScore(r.개선후가능성),
      개선후중대성: toScore(r.개선후중대성)
    };
  });
  return { 작업명: toText(obj.작업명) || "작업", 항목: items };
}
var MIN_RETRY_MS = 5e4;
var FALLBACK_RESERVE_MS = 25e3;
var DRAFT_EFFORT = (() => {
  const v = process.env.DRAFT_REASONING_EFFORT?.trim();
  return v === "none" || v === "low" || v === "medium" || v === "high" ? v : void 0;
})();
async function aiDraft(apiKey, description, reference, opts = {}) {
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `다음 작업 설명으로 위험성평가표 초안을 작성해.

<작업설명>
${description}
</작업설명>` + (reference ? `

<참고자료 설명="공공 위험성평가 표준모델에서 비슷한 작업을 찾은 결과. 설명과 맞는 것만 골라 고쳐 쓰고, 맞지 않으면 무시해">
${reference}
</참고자료>` : "")
    }
  ];
  const canFallback = opts.fallback !== false;
  let model = canFallback ? await pickModel(apiKey) : MODEL;
  let attempts = 0;
  let lastModel = model;
  let assessment = null;
  let report = null;
  let formatRetried = false;
  let repaired = false;
  const switchToFallback = async (why) => {
    if (!canFallback || assessment || model !== MODEL) return false;
    const next = await nextFallback(apiKey, MODEL, opts.deadline ? opts.deadline - Date.now() : Infinity);
    if (!next) return false;
    console.error(`[assess] 기본 모델이 ${why} 무료 모델로 다시 요청합니다.`);
    model = next;
    return true;
  };
  while (attempts < 3) {
    const left = opts.deadline ? opts.deadline - Date.now() : TIMEOUT_MS;
    const minRetry = model === MODEL ? MIN_RETRY_MS : 15e3;
    if (attempts > 0 && opts.deadline && left < minRetry) {
      console.error("[assess] 남은 시간이 모자라 다시 요청하지 않습니다.");
      break;
    }
    attempts++;
    const effort = model !== MODEL ? "none" : opts.effort ?? DRAFT_EFFORT;
    const reserve = opts.deadline && canFallback && model === MODEL && !assessment && left - FALLBACK_RESERVE_MS >= 3e4;
    const wait = opts.deadline ? Math.max(left - (reserve ? FALLBACK_RESERVE_MS : 0), 1e3) : TIMEOUT_MS;
    let reply;
    try {
      reply = await callOpenRouter(
        apiKey,
        messages,
        wait,
        model,
        effort === "none" ? { enabled: false } : effort ? { effort } : void 0
      );
    } catch (err) {
      if (err instanceof DraftError && err.status === 504 && assessment) break;
      if (err instanceof DraftError && err.status === 504 && reserve && await switchToFallback("시간 안에 답하지 않아")) {
        attempts--;
        continue;
      }
      if (isRefusal(err)) {
        if (canFallback) markDown(MODEL);
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
        content: `검사기가 아래 오류를 찾았어. 오류를 모두 고친 평가표 전체를 같은 JSON 형식으로 다시 써. 오류가 없는 항목은 그대로 둬.
${report.errors.map((e) => `- ${e}`).join("\n")}`
      }
    );
  }
  if (!assessment || !report) throw new DraftError("AI 답의 형식이 올바르지 않아요.", 502);
  return { assessment, report, model: lastModel, attempts };
}

// lib/safety-summary.ts
var LANGUAGES = {
  vi: { name: "베트남어", native: "Tiếng Việt" },
  km: { name: "크메르어 (캄보디아)", native: "ភាសាខ្មែរ" },
  ne: { name: "네팔어", native: "नेपाली" },
  id: { name: "인도네시아어", native: "Bahasa Indonesia" },
  my: { name: "미얀마어", native: "မြန်မာဘာသာ" },
  uz: { name: "우즈베크어", native: "Oʻzbekcha" },
  en: { name: "영어", native: "English" }
};

// lib/translate.ts
var BACK_OVERLAP_MIN = 0.3;
var NO_THINKING = { enabled: false };
var JSON_SHAPE = '{"title":"...","lines":[{"risk":"...","todo":"..."}]}';
function parsePairs(content) {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const data = JSON.parse(content.slice(start, end + 1));
    if (!Array.isArray(data.lines)) return null;
    const lines = data.lines.map((l) => {
      const r = l ?? {};
      return { risk: String(r.risk ?? "").trim(), todo: String(r.todo ?? "").trim() };
    });
    return { title: String(data.title ?? "").trim(), lines };
  } catch {
    return null;
  }
}
function bigrams(text) {
  const out = /* @__PURE__ */ new Set();
  for (const word of text.match(/[가-힣A-Za-z0-9]+/g) ?? []) {
    const ch = Array.from(word);
    for (let i = 0; i < ch.length - 1; i++) out.add(ch[i] + ch[i + 1]);
  }
  return out;
}
function overlap(a, b) {
  const A = bigrams(a);
  const B = bigrams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / Math.min(A.size, B.size);
}
var HANGUL = /[가-힣]/;
var timeLeft = (deadline) => deadline ? Math.max(deadline - Date.now(), 1e3) : 12e4;
async function translateLines(apiKey, source, lang, opts = {}) {
  const target = LANGUAGES[lang];
  const messages = [
    {
      role: "system",
      content: `너는 한국 공장에서 일하는 외국인 근로자에게 안전 안내문을 옮기는 번역가야. ${target.name}(${target.native})로 옮겨.
- 한국어를 잘 모르는 사람이 읽는다. 쉬운 단어와 짧은 문장으로 쓴다.
- 뜻을 더하거나 빼지 마. 기계·물질 이름은 그 언어에서 흔히 쓰는 말로, 없으면 소리 나는 대로 쓴다.
- 숫자와 단위는 그대로 둔다. 한글을 남기지 마.
- 다른 말 없이 같은 형태의 JSON 하나만 답해: ${JSON_SHAPE} (줄 수와 순서는 그대로)`
    },
    { role: "user", content: JSON.stringify({ title: source.title, lines: source.lines.map(({ risk, todo }) => ({ risk, todo })) }) }
  ];
  const res = await callWithFallback(apiKey, messages, timeLeft(opts.deadline), NO_THINKING);
  const parsed = parsePairs(res.content);
  if (!parsed || parsed.lines.length !== source.lines.length) {
    throw new DraftError("번역 답의 형식이 올바르지 않아요. 다시 옮겨 보세요.", 502);
  }
  return { lang, title: parsed.title || source.title, lines: parsed.lines, model: res.model };
}
async function backCheck(apiKey, source, translated, opts = {}) {
  const target = LANGUAGES[translated.lang];
  const messages = [
    {
      role: "system",
      content: `아래 ${target.name} 안전 안내문을 한국어로 직역해. 뜻을 고치거나 보태지 말고 쓰인 그대로 옮겨.
다른 말 없이 같은 형태의 JSON 하나만 답해: ${JSON_SHAPE} (줄 수와 순서는 그대로)`
    },
    { role: "user", content: JSON.stringify({ title: translated.title, lines: translated.lines }) }
  ];
  const res = await callWithFallback(apiKey, messages, timeLeft(opts.deadline), NO_THINKING);
  const back = parsePairs(res.content);
  if (!back || back.lines.length !== source.lines.length) {
    throw new DraftError("역번역 답의 형식이 올바르지 않아요. 다시 검사해 보세요.", 502);
  }
  const lines = source.lines.map((src, i) => {
    const t = translated.lines[i];
    const b = back.lines[i];
    const ov = Math.min(overlap(src.risk, b.risk), overlap(src.todo, b.todo));
    const notes = [];
    if (!t.risk || !t.todo) notes.push("번역이 비어 있어요");
    if (translated.lang !== "en" && (HANGUL.test(t.risk) || HANGUL.test(t.todo))) notes.push("번역문에 한글이 남아 있어요");
    if (ov < BACK_OVERLAP_MIN) notes.push("다시 한국어로 옮긴 뜻이 원문과 많이 달라요");
    return {
      risk: t.risk,
      todo: t.todo,
      backRisk: b.risk,
      backTodo: b.todo,
      overlap: Math.round(ov * 100) / 100,
      ok: notes.length === 0,
      ...notes.length ? { note: notes.join(", ") } : {}
    };
  });
  return {
    lang: translated.lang,
    title: translated.title,
    source,
    lines,
    ok: lines.every((l) => l.ok),
    model: res.model
  };
}

// supabase/functions/ai-draft/source.ts
var AI_BUDGET_MS = 135e3;
var sql = postgres(Deno.env.get("SUPABASE_DB_URL"), { prepare: false, max: 2 });
var json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function run(jobId, apiKey, job) {
  try {
    const deadline = Date.now() + AI_BUDGET_MS;
    const p = job.payload;
    const result = p?.step === "translate" ? await translateLines(apiKey, p.source, p.lang, { deadline }) : p?.step === "backcheck" ? await backCheck(apiKey, p.source, p.translated, { deadline }) : await aiDraft(apiKey, job.description, job.reference, { deadline });
    await sql`UPDATE ai_jobs SET status = 'done', result = ${sql.json(result)}, finished_at = now() WHERE id = ${jobId}`;
  } catch (err) {
    const reason = err instanceof DraftError ? err.message : "AI 작업을 마치지 못했어요.";
    if (!(err instanceof DraftError)) console.error("[ai-draft] 알 수 없는 오류");
    await sql`UPDATE ai_jobs SET status = 'failed', error = ${reason}, finished_at = now() WHERE id = ${jobId}`.catch(
      () => console.error("[ai-draft] 실패 기록 저장 실패")
    );
  }
}
Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST만 받습니다." }, 405);
  const body = await req.json().catch(() => null);
  const jobId = typeof body?.jobId === "string" ? body.jobId : "";
  const token = typeof body?.token === "string" ? body.token : "";
  if (!/^[0-9a-f-]{36}$/.test(jobId) || !/^[0-9a-f]{64}$/.test(token)) return json({ error: "잘못된 요청" }, 400);
  const apiKey = Deno.env.get("OPENROUTER_API_KEY") || req.headers.get("x-openrouter-key") || "";
  if (!apiKey) return json({ error: "AI 키 없음" }, 400);
  const rows = await sql`
    UPDATE ai_jobs SET status = 'running', started_at = now()
     WHERE id = ${jobId} AND token_hash = ${await sha256Hex(token)} AND status = 'queued'
     RETURNING kind, description, reference, payload`;
  if (!rows.length) return json({ error: "없는 작업" }, 404);
  EdgeRuntime.waitUntil(run(jobId, apiKey, rows[0]));
  return json({ accepted: true }, 202);
});
