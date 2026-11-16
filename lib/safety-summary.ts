// 외국인 근로자용 안전 요약 (AI ④). 화면과 서버가 함께 쓴다 (서버 전용 코드는 import하지 않는다).
//
// 1) 쉬운 한국어 요약은 코드가 평가표에서 만든다: 위험성이 높은 항목부터 최대 MAX_LINES개,
//    줄마다 "무엇이 위험한지"와 "무엇을 지킬지". 원문을 코드가 정하니 AI가 내용을 바꿀 여지가 줄어든다.
// 2) AI는 그 문장을 다른 언어로 옮기기만 한다 (lib/translate.ts).
// 3) 역번역 검사: AI가 번역문을 다시 한국어로 옮기고, 코드가 원문과 글자 조각 겹침을 비교한다.
import { riskLevel, type Assessment, type RiskLevel } from "./schema";

export const MAX_LINES = 6;

// 외국인 근로자(E-9) 출신이 많은 나라 순서를 참고해 고른 언어. 영어는 필리핀 등 공용.
export const LANGUAGES = {
  vi: { name: "베트남어", native: "Tiếng Việt" },
  km: { name: "크메르어 (캄보디아)", native: "ភាសាខ្មែរ" },
  ne: { name: "네팔어", native: "नेपाली" },
  id: { name: "인도네시아어", native: "Bahasa Indonesia" },
  my: { name: "미얀마어", native: "မြန်မာဘာသာ" },
  uz: { name: "우즈베크어", native: "Oʻzbekcha" },
  en: { name: "영어", native: "English" },
} as const;

export type Lang = keyof typeof LANGUAGES;
export const isLang = (v: unknown): v is Lang => typeof v === "string" && Object.hasOwn(LANGUAGES, v);

export type SummaryLine = { risk: string; todo: string; level: RiskLevel };
export type KoreanSummary = { title: string; lines: SummaryLine[] };

// 1단계 결과: 번역만 된 상태 (아직 역번역 검사 전)
export type TranslatedText = {
  lang: Lang;
  title: string;
  lines: { risk: string; todo: string }[];
  model: string;
};

// 번역 결과 한 줄과 역번역 검사
export type TranslatedLine = {
  risk: string;
  todo: string;
  backRisk: string;
  backTodo: string;
  overlap: number; // 원문과 역번역의 글자 조각 겹침 (0~1)
  ok: boolean;
  note?: string;
};

export type TranslationResult = {
  lang: Lang;
  title: string;
  source: KoreanSummary;
  lines: TranslatedLine[];
  ok: boolean; // 모든 줄이 검사 통과
  model: string;
};

const trimSentence = (s: string, max = 70) => {
  const t = s.replace(/\s+/g, " ").replace(/\s*(위험|위험성)$/u, "").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

// 평가표 → 쉬운 한국어 요약 (같은 위험요인은 한 번만, 위험성 높은 순)
export function buildKoreanSummary(a: Assessment): KoreanSummary {
  const seen = new Set<string>();
  const items = [...a.항목]
    .map((it) => ({ it, score: (it.가능성 || 0) * (it.중대성 || 0) }))
    .sort((x, y) => y.score - x.score)
    .filter(({ it }) => {
      const key = it.유해위험요인.replace(/\s+/g, "");
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_LINES);
  return {
    title: a.작업명,
    lines: items.map(({ it }) => ({
      risk: trimSentence(it.유해위험요인),
      todo: trimSentence(it.감소대책.slice(0, 2).join(", ") || "작업 전에 반장에게 안전 방법을 물어보세요", 90),
      level: riskLevel(it.가능성, it.중대성),
    })),
  };
}
