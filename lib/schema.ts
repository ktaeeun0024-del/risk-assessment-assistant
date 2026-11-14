// 위험성평가표 형식과 공통 규칙 (화면과 서버가 함께 쓴다)
//
// 근거: 「사업장 위험성평가에 관한 지침」(고용노동부 고시 제2023-19호)은 빈도·강도법, 체크리스트법,
// 위험성 수준 3단계 판단법, 핵심요인 기술법 중 하나 이상을 골라 쓰게 한다.
// 이 도구는 소규모 사업장이 쓰기 쉬운 3x3 빈도·강도법을 쓴다. 항목 구성은 안전보건공단 KRAS 양식을 따른다.

// KRAS 유해·위험요인 분류 6가지
export const CATEGORIES = [
  "기계적 요인",
  "전기적 요인",
  "화학(물질)적 요인",
  "생물학적 요인",
  "작업특성 요인",
  "작업환경 요인",
] as const;

export type Category = (typeof CATEGORIES)[number];

export const LIKELIHOOD: Record<number, string> = {
  1: "낮음(거의 없음)",
  2: "보통(가끔 발생 가능)",
  3: "높음(자주 발생 가능)",
};

export const SEVERITY: Record<number, string> = {
  1: "경미(치료 후 바로 복귀)",
  2: "중간(휴업이 필요한 부상)",
  3: "치명(사망·장해·직업병)",
};

export type RiskLevel = "낮음" | "보통" | "높음";

export function riskLevel(likelihood: number, severity: number): RiskLevel {
  const score = likelihood * severity;
  return score >= 6 ? "높음" : score >= 3 ? "보통" : "낮음";
}

export type AssessmentItem = {
  세부작업: string;
  분류: string;
  원인: string;
  유해위험요인: string;
  관련근거: string;
  현재조치: string;
  가능성: number;
  중대성: number;
  감소대책: string[];
  개선후가능성: number;
  개선후중대성: number;
};

export type Assessment = {
  작업명: string;
  항목: AssessmentItem[];
};

export type ValidationReport = {
  ok: boolean;
  errors: string[];
  warnings: string[];
};

// '기계적(설비) 요인', '1. 기계적요인' 같은 표기를 KRAS 6분류로 맞춘다. 못 맞추면 빈 문자열.
export function normalizeCategory(raw: string): string {
  const s = String(raw).replace(/^\d+\.\s*|\s+/g, "");
  const pairs: [string, Category][] = [
    ["기계", "기계적 요인"],
    ["전기", "전기적 요인"],
    ["화학", "화학(물질)적 요인"],
    ["생물", "생물학적 요인"],
    ["작업특성", "작업특성 요인"],
    ["작업환경", "작업환경 요인"],
  ];
  return pairs.find(([key]) => s.includes(key))?.[1] ?? "";
}

const LAW_PATTERN =
  /(안전보건규칙|산업안전보건법\s*시행규칙|산업안전보건법\s*시행령|산업안전보건법|산안법)\s*제?\s*(\d+)\s*조/g;

// '안전보건규칙 제171조 [잠금장치의 체결]' → ['안전보건규칙 제171조']
export function extractLawRefs(text: string): string[] {
  const out: string[] = [];
  for (const m of String(text ?? "").matchAll(LAW_PATTERN)) {
    const law = m[1].replace(/\s+/g, " ").replace("산안법", "산업안전보건법");
    out.push(`${law} 제${Number(m[2])}조`);
  }
  return [...new Set(out)];
}
