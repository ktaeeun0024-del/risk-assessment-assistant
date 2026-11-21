// 작업 전 점검 체크리스트 (11/24): 완성된 평가표의 감소대책을 "오늘 작업 전에 확인할 것"으로 바꾼다.
// AI를 부르지 않고 코드가 만든다. 화면과 서버가 같이 쓴다.
// - 위험성(가능성 × 중대성)이 높은 항목의 대책부터
// - 같은 대책(띄어쓰기·문장부호만 다른 것 포함)은 한 번만
// - 너무 길면 반장이 작업 전에 다 볼 수 없으므로 최대 12개
import { riskLevel, type Assessment, type RiskLevel } from "./schema";

export type CheckItem = {
  action: string; // 확인할 것 (감소대책 문장)
  task: string; // 세부작업
  hazard: string; // 어떤 위험 때문에
  level: RiskLevel; // 지금 위험성
  score: number; // 가능성 × 중대성
};

export const MAX_CHECKS = 12;

const key = (s: string) => s.replace(/[\s.,·'"()\-]/g, "");

export function buildChecklist(assessment: Assessment, max = MAX_CHECKS): CheckItem[] {
  const rows = assessment.항목
    .map((it) => ({ it, score: it.가능성 * it.중대성 }))
    .filter(({ it }) => Number.isFinite(it.가능성) && Number.isFinite(it.중대성))
    .sort((a, b) => b.score - a.score);
  const seen = new Set<string>();
  const out: CheckItem[] = [];
  for (const { it, score } of rows) {
    for (const m of it.감소대책 ?? []) {
      const action = String(m).trim();
      if (!action || seen.has(key(action))) continue;
      seen.add(key(action));
      out.push({ action, task: it.세부작업, hazard: it.유해위험요인, level: riskLevel(it.가능성, it.중대성), score });
      if (out.length >= max) return out;
    }
  }
  return out;
}
