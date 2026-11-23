// 체험 계정(11/23)에 미리 넣어 둘 AI 평가표를 만든다 → data/demo_assessments.json
// 포스터 QR로 들어온 사람이 AI를 기다리지 않고도 AI 초안·매일 점검·점검 기록을 볼 수 있게 하려는 것.
// 무료 AI를 작업 수만큼(2번) 부른다. 검사기를 통과한 결과만 저장한다.
// 실행: npm run data:demo   (.env의 OPENROUTER_API_KEY 필요)
import { existsSync, readFileSync, writeFileSync } from "node:fs";

if (existsSync(".env")) process.loadEnvFile(".env");
process.env.AI_TIMEOUT_MS = "300000"; // 미리 한 번 만드는 것이라 화면보다 오래 기다린다

const { aiDraft } = await import("../lib/ai");
const { retrieveDraft, referenceText } = await import("../lib/retrieve");
const { EXAMPLE } = await import("../lib/options");

// 체험 회사의 작업 설명. 첫 번째는 화면의 '예시 넣기'와 같다.
const DESCRIPTIONS = [
  EXAMPLE,
  "완성된 부품을 상자에 담아 테이프로 포장하고, 지게차로 팔레트를 출하장의 화물차에 싣습니다. " +
    "작업자 4명 중 2명은 베트남과 네팔 출신이고, 지게차는 1명이 운전합니다. " +
    "출하장 바닥에는 팔레트 조각과 랩이 자주 떨어져 있고, 화물차 적재함에 오르내릴 때 발판이 없습니다.",
];

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) throw new Error("OPENROUTER_API_KEY가 없어요 (.env)");

// 하나씩 저장한다: 무료 AI가 느려 중간에 실패해도 앞에서 만든 것은 남고, 다시 돌리면 AI가 아닌 것만 새로 만든다
const FILE = "data/demo_assessments.json";
type Saved = { description: string; mode: string; model: string; assessment: unknown; report: unknown };
const out: Saved[] = existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : [];
for (const [i, description] of DESCRIPTIONS.entries()) {
  if (out[i]?.description === description && out[i]?.mode === "ai") {
    console.log(`${i + 1}번은 이미 AI 평가표라 건너뜀`);
    continue;
  }
  const started = Date.now();
  const searched = retrieveDraft(description);
  const ai = await aiDraft(apiKey, description, referenceText(searched.sources, searched.assessment), { fallback: false }); // 기본 모델로만 (대체 모델은 품질이 낮음)
  const secs = Math.round((Date.now() - started) / 1000);
  console.log(`${ai.assessment.작업명}: ${ai.assessment.항목.length}항목, 검사 ${ai.report.ok ? "통과" : "실패"}, ${secs}초`);
  if (!ai.report.ok) throw new Error("검사를 통과하지 못했어요. 다시 실행해 주세요.");
  out[i] = { description, mode: "ai", model: ai.model, assessment: ai.assessment, report: ai.report };
  writeFileSync(FILE, JSON.stringify(out, null, 1));
  console.log(`저장: ${FILE} (${i + 1}번)`);
}
