// 검증 측정: 검증 세트 20종을 실제 서비스와 같은 순서(검색 초안 → AI 초안 → 검사기)로 돌려 재현율을 잰다.
// 측정할 때는 평가 대상 원본 파일(eval_set.json의 exclude)을 검색에서 뺀다.
//
// 실행 예
//   npm run eval -- --mode search                          검색 초안 (AI 없음, 무료·무제한)
//   npm run eval -- --mode ai --model 모델ID:free           AI 초안 (모델 하나로 고정)
//   npm run eval -- --mode ai --model 모델ID:free --cases E01,E02   일부만
// 결과: 화면에 표, eval/results/에 항목별 상세 JSON (git에는 올리지 않음)
//
// 무료 모델은 1분 20회, 하루 50회(크레딧을 산 적 없을 때) 한도가 있다. 작업 하나에 AI 호출이 1~3번이라
// 20종을 한 번에 돌리면 한도를 넘을 수 있다 → --cases로 10종씩 나눠 돌린다.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { scoreCase, type CaseScore } from "./match";

type Gold = { text: string; 분류: string; 세부작업: string; types: string[] };
type EvalCase = { id: string; title: string; source: string; description: string; exclude: string[]; gold: Gold[] };

function arg(name: string, fallback = ""): string {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const mode = arg("mode", "search");
if (mode !== "search" && mode !== "ai") throw new Error("--mode는 search 또는 ai");
const model = arg("model");
if (mode === "ai" && !model) throw new Error("AI 측정은 --model로 무료 모델 하나를 고정해야 합니다 (예: --model 모델ID:free)");
const only = arg("cases") ? new Set(arg("cases").split(",").map((s) => s.trim())) : null;
const delayMs = Number(arg("delay", mode === "ai" ? "4000" : "0"));

// .env의 OPENROUTER_API_KEY를 읽는다. 모델은 lib/ai.ts가 불러질 때 정해지므로 import 전에 넣는다.
if (existsSync(".env")) process.loadEnvFile(".env");
if (model) process.env.OPENROUTER_MODEL = model;
if (mode === "ai") process.env.AI_TIMEOUT_MS ||= "120000";

const { retrieveDraft, referenceText } = await import("../lib/retrieve");
const { validate } = await import("../lib/validator");
const { aiDraft, DraftError, PROMPT_VERSION } = await import("../lib/ai");

const set = JSON.parse(readFileSync(new URL("./eval_set.json", import.meta.url), "utf8")) as { cases: EvalCase[] };
const cases = set.cases.filter((c) => !only || only.has(c.id));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Row = {
  id: string;
  title: string;
  ok: boolean;
  error?: string;
  seconds: number;
  attempts: number;
  model: string;
  validatorOk?: boolean;
  validatorErrors?: number;
  validatorWarnings?: number;
  score?: CaseScore;
  predicted?: string[];
};
const rows: Row[] = [];

for (const [n, c] of cases.entries()) {
  if (n && delayMs) await sleep(delayMs);
  const t0 = Date.now();
  const excludeFiles = new Set(c.exclude);
  const searched = retrieveDraft(c.description, c.title, { excludeFiles });
  const row: Row = { id: c.id, title: c.title, ok: false, seconds: 0, attempts: 0, model: mode === "ai" ? model : "표준모델 검색(BM25)" };
  try {
    let assessment = searched.assessment;
    if (mode === "ai") {
      const apiKey = process.env.OPENROUTER_API_KEY;
      if (!apiKey) throw new Error(".env에 OPENROUTER_API_KEY가 없습니다");
      const reference = referenceText(searched.sources, searched.assessment);
      let ai;
      try {
        ai = await aiDraft(apiKey, c.description, reference);
      } catch (err) {
        // 1분 한도에 걸리면 잠시 쉬고 한 번만 다시 시도
        if (err instanceof DraftError && err.status === 429) {
          console.log(`  ${c.id}: 요청이 많아 40초 쉬고 다시 시도`);
          await sleep(40_000);
          ai = await aiDraft(apiKey, c.description, reference);
        } else throw err;
      }
      assessment = ai.assessment;
      row.attempts = ai.attempts;
      row.model = ai.model;
    }
    const report = validate(assessment);
    const predicted = assessment.항목.map((it) => it.유해위험요인);
    Object.assign(row, {
      ok: true,
      validatorOk: report.ok,
      validatorErrors: report.errors.length,
      validatorWarnings: report.warnings.length,
      score: scoreCase(c.gold.map((g) => g.text), predicted),
      predicted,
    });
  } catch (err) {
    row.error = err instanceof Error ? err.message : String(err);
  }
  row.seconds = Math.round((Date.now() - t0) / 100) / 10;
  rows.push(row);
  const s = row.score;
  console.log(
    row.ok && s
      ? `${c.id} ${c.title.padEnd(14)} 정답 ${String(s.goldCount).padStart(2)} 초안 ${String(s.predCount).padStart(2)}  재현율 ${pct(s.hazardRecall)}  유형 ${pct(s.typeRecall)}  검사 ${row.validatorOk ? "통과" : "오류"}  ${row.seconds}초`
      : `${c.id} ${c.title.padEnd(14)} 실패: ${row.error}`,
  );
}

function pct(x: number) {
  return `${Math.round(x * 100)}%`.padStart(4);
}
const okRows = rows.filter((r) => r.ok && r.score);
const avg = (f: (r: Row) => number, list = okRows) => (list.length ? list.reduce((a, r) => a + f(r), 0) / list.length : 0);
const summary = {
  mode,
  model: mode === "ai" ? model : "표준모델 검색(BM25)",
  promptVersion: mode === "ai" ? PROMPT_VERSION : "-",
  cases: rows.length,
  succeeded: okRows.length,
  hazardRecall: avg((r) => r.score!.hazardRecall),
  // 실패한 작업을 0점으로 넣은 재현율 (서비스에서는 실패하면 검색 초안으로 대신하지만, 모델 자체 실력을 보기 위해 따로 적는다)
  hazardRecallWithFailures: rows.length ? okRows.reduce((a, r) => a + r.score!.hazardRecall, 0) / rows.length : 0,
  typeRecall: avg((r) => r.score!.typeRecall),
  matchedPredRate: avg((r) => r.score!.matchedPredRate),
  validatorPassRate: avg((r) => (r.validatorOk ? 1 : 0)),
  avgItems: avg((r) => r.score!.predCount),
  avgSeconds: avg((r) => r.seconds, rows),
  avgAttempts: mode === "ai" ? avg((r) => r.attempts) : 0,
};

console.log("\n─ 요약 ─");
console.log(`방식 ${summary.mode} | 모델 ${summary.model} | 성공 ${summary.succeeded}/${summary.cases}`);
console.log(
  `위험요인 재현율 ${pct(summary.hazardRecall)} (실패 포함 ${pct(summary.hazardRecallWithFailures)}) | 사고 유형 재현율 ${pct(summary.typeRecall)} | ` +
    `초안 중 정답과 겹친 비율 ${pct(summary.matchedPredRate)} | 검사기 통과 ${pct(summary.validatorPassRate)} | ` +
    `항목 ${summary.avgItems.toFixed(1)}개 | 1건 ${summary.avgSeconds.toFixed(1)}초`,
);

mkdirSync(new URL("./results/", import.meta.url), { recursive: true });
const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
const slug = (mode === "ai" ? model : "search").replace(/[^A-Za-z0-9._-]+/g, "_");
const file = new URL(`./results/${stamp}_${mode}_${slug}.json`, import.meta.url);
writeFileSync(file, JSON.stringify({ summary, rows }, null, 2) + "\n");
console.log(`상세 결과: eval/results/${stamp}_${mode}_${slug}.json`);
