// 평가표 검사기: AI가 쓴 위험성평가표를 코드가 다시 검사한다.
// 원칙: AI가 쓰고 코드가 검증한다. 결과는 '오류'(고쳐야 함)와 '확인 필요'(사람이 볼 것)로 나눈다.
// src/validator.py와 같은 규칙이다.
import {
  CATEGORIES,
  extractLawRefs,
  riskLevel,
  type Assessment,
  type ValidationReport,
} from "./schema";
import { KNOWN_LAW_REFS } from "./standard-models";

const REQUIRED_TEXT = ["세부작업", "원인", "유해위험요인"] as const;
const LEVEL_ORDER = { 낮음: 0, 보통: 1, 높음: 2 } as const;
const isScore = (v: unknown) => v === 1 || v === 2 || v === 3;

export function validate(assessment: Assessment): ValidationReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const items = assessment?.항목 ?? [];
  if (items.length === 0) errors.push("평가 항목이 하나도 없습니다");

  const seen = new Set<string>();
  items.forEach((it, i) => {
    const tag = `${i + 1}번 항목`;
    for (const k of REQUIRED_TEXT) {
      if (!String(it[k] ?? "").trim()) errors.push(`${tag}: '${k}'이(가) 비어 있습니다`);
    }
    if (!(CATEGORIES as readonly string[]).includes(it.분류)) {
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
    const key = `${it.세부작업}|${it.유해위험요인}`;
    if (seen.has(key)) warnings.push(`${tag}: 앞 항목과 중복됩니다`);
    seen.add(key);
  });
  return { ok: errors.length === 0, errors, warnings };
}
