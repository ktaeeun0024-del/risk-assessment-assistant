// AI ④ 번역과 역번역 검사. 서버에서만 쓴다 (Supabase Edge Function에도 함께 묶인다).
//
// 두 단계로 나눈다 (배포 사이트에서는 단계마다 Supabase 함수를 따로 불러 각각 최대 150초를 쓴다)
//  1단계 translateLines: 쉬운 한국어 요약(lib/safety-summary.ts) → 대상 언어 (쉬운 단어, 짧은 문장)
//  2단계 backCheck:      번역문 → 한국어 직역(역번역) → 코드 검사
// 코드 검사: 줄 수가 같은지, 번역문에 한글이 남았는지, 원문과 역번역의 글자 조각이 충분히 겹치는지.
// 겹침이 낮은 줄은 "확인 필요"로 표시해 그 언어를 아는 동료나 반장이 다시 보게 한다.
// 번역은 깊이 생각할 일이 아니라서 모델의 생각(reasoning)을 끈다: 크메르어 번역 143초 → 79초 (11/16 시험).
import { callOpenRouter, DEFAULT_MODEL, DraftError, type Message } from "./ai";
import {
  LANGUAGES,
  type KoreanSummary,
  type Lang,
  type TranslatedLine,
  type TranslatedText,
  type TranslationResult,
} from "./safety-summary";

// 원문과 역번역의 겹침이 이보다 낮으면 확인 필요 (짧은 문장·의역을 고려해 낮게 둔다)
export const BACK_OVERLAP_MIN = 0.3;
const MODEL = process.env.OPENROUTER_MODEL?.trim() || DEFAULT_MODEL;
const NO_THINKING = { enabled: false } as const;
const JSON_SHAPE = '{"title":"...","lines":[{"risk":"...","todo":"..."}]}';

type Pair = { risk: string; todo: string };

function parsePairs(content: string): { title: string; lines: Pair[] } | null {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const data = JSON.parse(content.slice(start, end + 1)) as { title?: unknown; lines?: unknown };
    if (!Array.isArray(data.lines)) return null;
    const lines = data.lines.map((l) => {
      const r = (l ?? {}) as Record<string, unknown>;
      return { risk: String(r.risk ?? "").trim(), todo: String(r.todo ?? "").trim() };
    });
    return { title: String(data.title ?? "").trim(), lines };
  } catch {
    return null;
  }
}

// 한글 낱말을 글자 2개씩 자른 조각 (lib/retrieve.ts·eval/match.ts와 같은 방식)
function bigrams(text: string): Set<string> {
  const out = new Set<string>();
  for (const word of text.match(/[가-힣A-Za-z0-9]+/g) ?? []) {
    const ch = Array.from(word);
    for (let i = 0; i < ch.length - 1; i++) out.add(ch[i] + ch[i + 1]);
  }
  return out;
}

export function overlap(a: string, b: string): number {
  const A = bigrams(a);
  const B = bigrams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / Math.min(A.size, B.size);
}

const HANGUL = /[가-힣]/;
const timeLeft = (deadline?: number) => (deadline ? Math.max(deadline - Date.now(), 1_000) : 120_000);

// 1단계: 번역
export async function translateLines(
  apiKey: string,
  source: KoreanSummary,
  lang: Lang,
  opts: { deadline?: number } = {},
): Promise<TranslatedText> {
  const target = LANGUAGES[lang];
  const messages: Message[] = [
    {
      role: "system",
      content:
        `너는 한국 공장에서 일하는 외국인 근로자에게 안전 안내문을 옮기는 번역가야. ${target.name}(${target.native})로 옮겨.\n` +
        "- 한국어를 잘 모르는 사람이 읽는다. 쉬운 단어와 짧은 문장으로 쓴다.\n" +
        "- 뜻을 더하거나 빼지 마. 기계·물질 이름은 그 언어에서 흔히 쓰는 말로, 없으면 소리 나는 대로 쓴다.\n" +
        "- 숫자와 단위는 그대로 둔다. 한글을 남기지 마.\n" +
        `- 다른 말 없이 같은 형태의 JSON 하나만 답해: ${JSON_SHAPE} (줄 수와 순서는 그대로)`,
    },
    { role: "user", content: JSON.stringify({ title: source.title, lines: source.lines.map(({ risk, todo }) => ({ risk, todo })) }) },
  ];
  const res = await callOpenRouter(apiKey, messages, timeLeft(opts.deadline), MODEL, NO_THINKING);
  const parsed = parsePairs(res.content);
  if (!parsed || parsed.lines.length !== source.lines.length) {
    throw new DraftError("번역 답의 형식이 올바르지 않아요. 다시 옮겨 보세요.", 502);
  }
  return { lang, title: parsed.title || source.title, lines: parsed.lines, model: res.model };
}

// 2단계: 역번역 검사 (원문은 서버가 평가표에서 다시 만든 것을 쓴다)
export async function backCheck(
  apiKey: string,
  source: KoreanSummary,
  translated: TranslatedText,
  opts: { deadline?: number } = {},
): Promise<TranslationResult> {
  const target = LANGUAGES[translated.lang];
  const messages: Message[] = [
    {
      role: "system",
      content:
        `아래 ${target.name} 안전 안내문을 한국어로 직역해. 뜻을 고치거나 보태지 말고 쓰인 그대로 옮겨.\n` +
        `다른 말 없이 같은 형태의 JSON 하나만 답해: ${JSON_SHAPE} (줄 수와 순서는 그대로)`,
    },
    { role: "user", content: JSON.stringify({ title: translated.title, lines: translated.lines }) },
  ];
  const res = await callOpenRouter(apiKey, messages, timeLeft(opts.deadline), MODEL, NO_THINKING);
  const back = parsePairs(res.content);
  if (!back || back.lines.length !== source.lines.length) {
    throw new DraftError("역번역 답의 형식이 올바르지 않아요. 다시 검사해 보세요.", 502);
  }

  const lines: TranslatedLine[] = source.lines.map((src, i) => {
    const t = translated.lines[i];
    const b = back.lines[i];
    const ov = Math.min(overlap(src.risk, b.risk), overlap(src.todo, b.todo));
    const notes: string[] = [];
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
      ...(notes.length ? { note: notes.join(", ") } : {}),
    };
  });

  return {
    lang: translated.lang,
    title: translated.title,
    source,
    lines,
    ok: lines.every((l) => l.ok),
    model: res.model,
  };
}
