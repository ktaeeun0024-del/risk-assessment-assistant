// 사람 판정: 자동 채점(match.ts)이 놓치거나 잘못 짝지은 것을 사람이 바로잡아 재현율을 다시 계산한다.
// 자동 채점은 글자가 겹치는지만 보므로 '칼에 손 베임' ↔ '칼날에 베임 위험'처럼 말이 다르면 놓친다.
//
// 1) 판정지 만들기:  npm run eval:review -- eval/results/<측정결과>.json
//    → 같은 폴더에 <측정결과>.review.json 이 생긴다 (이미 있으면 덮어쓰지 않음)
// 2) 판정지의 "판정" 칸을 채운다
//    - 초안: 번호가 붙은 AI 초안 목록 (참고용, 고치지 않음)
//    - 자동짝: 자동 채점이 맞혔다고 한 짝. 실제로 같은 위험이 아니면 "맞음"을 "틀림"으로 바꾼다
//    - 놓친정답: 자동 채점이 못 찾았다고 한 정답. 같은 뜻의 초안이 있으면 그 초안 번호를, 없으면 "없음"을 쓴다
//      (후보 = 겹침이 큰 초안 3개, 참고용. 후보 밖의 번호를 써도 된다)
//    - 남은초안: 어느 정답과도 짝이 안 된 초안. "맞는 위험"(정답엔 없지만 실제로 있을 만한 위험) / "틀림" / "중복"
//      놓친정답에 번호를 적은 초안은 비워 둬도 된다
// 3) 다시 계산:      npm run eval:review -- --apply eval/results/<측정결과>.review.json
//
// 초안 하나는 정답 하나에만 짝지을 수 있다 (1:1). 같은 번호를 두 번 쓰면 알려 준다.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { CaseScore } from "./match";
import { sameHazard, toHazard } from "./match";

type Row = { id: string; title: string; ok: boolean; score?: CaseScore; predicted?: string[] };
type Result = { summary: { mode: string; model: string }; rows: Row[] };

type ReviewCase = {
  id: string;
  title: string;
  초안: string[];
  자동짝: { 정답: string; 초안번호: number; 초안: string; 판정: "맞음" | "틀림" }[];
  놓친정답: { 정답: string; 후보: string[]; 판정: string }[];
  남은초안: { 번호: number; 초안: string; 판정: string }[];
};
type Review = { 측정결과: string; 모델: string; 판정자: string; 안내: string; cases: ReviewCase[] };

const args = process.argv.slice(2);
const applyMode = args.includes("--apply");
const file = args.find((a) => !a.startsWith("--"));
if (!file || !existsSync(file)) {
  console.error("사용법: npm run eval:review -- eval/results/<측정결과>.json  |  --apply <판정지>.review.json");
  process.exit(1);
}

if (!applyMode) makeSheet(file);
else applySheet(file);

function makeSheet(resultFile: string) {
  const out = resultFile.replace(/\.json$/, ".review.json");
  if (existsSync(out)) {
    console.error(`이미 판정지가 있습니다: ${out} (지우고 다시 만들거나 --apply로 계산하세요)`);
    process.exit(1);
  }
  const result = JSON.parse(readFileSync(resultFile, "utf8")) as Result;
  const cases: ReviewCase[] = [];
  for (const row of result.rows) {
    if (!row.ok || !row.score || !row.predicted) continue;
    const pred = row.predicted;
    const num = (text: string) => pred.indexOf(text) + 1;
    const pairedNums = new Set(row.score.found.map((f) => num(f.pred)));
    const free = pred.map((text, i) => ({ 번호: i + 1, text })).filter((p) => !pairedNums.has(p.번호));
    cases.push({
      id: row.id,
      title: row.title,
      초안: pred.map((t, i) => `${i + 1}) ${t}`),
      자동짝: row.score.found.map((f) => ({ 정답: f.gold, 초안번호: num(f.pred), 초안: f.pred, 판정: "맞음" })),
      놓친정답: row.score.missed.map((gold) => {
        const g = toHazard(gold);
        const 후보 = free
          .map((p) => ({ p, s: sameHazard(g, toHazard(p.text)).score }))
          .sort((a, b) => b.s - a.s)
          .slice(0, 3)
          .map(({ p }) => `${p.번호}) ${p.text}`);
        return { 정답: gold, 후보, 판정: "" };
      }),
      남은초안: free.map((p) => ({ 번호: p.번호, 초안: p.text, 판정: "" })),
    });
  }
  const sheet: Review = {
    측정결과: resultFile,
    모델: result.summary.model,
    판정자: "",
    안내:
      "자동짝: 같은 위험이 아니면 '틀림'. 놓친정답: 같은 뜻 초안 번호 또는 '없음'. 남은초안: '맞는 위험' / '틀림' / '중복' (놓친정답에 쓴 번호는 비워도 됨). 다 채우면 npm run eval:review -- --apply <이 파일>",
    cases,
  };
  writeFileSync(out, JSON.stringify(sheet, null, 2) + "\n");
  const missed = cases.reduce((a, c) => a + c.놓친정답.length, 0);
  const pairs = cases.reduce((a, c) => a + c.자동짝.length, 0);
  console.log(`판정지를 만들었습니다: ${out}`);
  console.log(`작업 ${cases.length}개 | 확인할 자동짝 ${pairs}개 | 놓친정답 ${missed}개`);
}

function applySheet(sheetFile: string) {
  const sheet = JSON.parse(readFileSync(sheetFile, "utf8")) as Review;
  const pct = (x: number) => `${Math.round(x * 100)}%`.padStart(4);
  const problems: string[] = [];
  let gold = 0, autoFound = 0, humanFound = 0, autoWrong = 0, autoMissedButPresent = 0, undecided = 0;
  let predTotal = 0, predValid = 0, predWrong = 0;
  console.log(`모델 ${sheet.모델} | 판정자 ${sheet.판정자 || "(안 적음)"}`);
  for (const c of sheet.cases) {
    const used = new Map<number, string>();
    const use = (n: number, where: string) => {
      if (!Number.isInteger(n) || n < 1 || n > c.초안.length) problems.push(`${c.id} ${where}: 없는 초안 번호 ${n}`);
      else if (used.has(n)) problems.push(`${c.id} 초안 ${n}번을 두 번 씀 (${used.get(n)} / ${where})`);
      else used.set(n, where);
    };
    let found = 0;
    for (const p of c.자동짝) {
      if (p.판정 === "틀림") autoWrong++;
      else if (p.판정 === "맞음") { found++; autoFound++; use(p.초안번호, "자동짝"); }
      else problems.push(`${c.id} 자동짝 판정은 '맞음' 또는 '틀림': "${p.판정}"`);
    }
    // 자동짝이 '틀림'이면 그 정답은 놓친 것으로 본다 (사람이 다른 초안을 찾아 짝지을 수 있게 놓친정답에 추가하지는 않음)
    for (const m of c.놓친정답) {
      const v = String(m.판정).trim();
      if (!v) { undecided++; continue; }
      if (v === "없음") continue;
      const n = Number(v.replace(/[^0-9]/g, ""));
      use(n, `놓친정답 "${m.정답.slice(0, 15)}…"`);
      found++; humanFound++; autoMissedButPresent++;
    }
    const caseGold = c.자동짝.length + c.놓친정답.length;
    gold += caseGold;
    // 초안 품질: 정답과 짝지어졌거나(사람 판정 포함) '맞는 위험'이면 쓸 만한 항목
    let valid = used.size;
    for (const r of c.남은초안) {
      if (used.has(r.번호)) continue;
      const v = String(r.판정).trim();
      if (v === "맞는 위험") valid++;
      else if (v === "틀림") predWrong++;
      else if (v !== "중복") undecided++;
    }
    predTotal += c.초안.length;
    predValid += valid;
    console.log(
      `${c.id} ${c.title.padEnd(12)} 정답 ${String(caseGold).padStart(2)} | 자동 재현율 ${pct((c.자동짝.length) / caseGold)} → 사람 판정 ${pct(found / caseGold)} | 쓸 만한 초안 ${valid}/${c.초안.length}`,
    );
  }
  const autoTotal = sheet.cases.reduce((a, c) => a + c.자동짝.length, 0);
  console.log("\n─ 사람 판정 요약 ─");
  console.log(`위험요인 재현율: 자동 ${pct(autoTotal / gold)} → 사람 판정 ${pct((autoFound + humanFound) / gold)}`);
  console.log(`채점기 확인: 자동짝 ${autoTotal}개 중 틀림 ${autoWrong}개 | 놓쳤다고 한 정답 중 실제로 초안에 있던 것 ${autoMissedButPresent}개`);
  console.log(`초안 품질: ${predTotal}개 중 쓸 만한 항목 ${predValid}개 (${pct(predValid / predTotal)}) | 틀린 항목 ${predWrong}개`);
  if (undecided) console.log(`아직 판정 안 한 칸 ${undecided}개 — 빈 칸은 '없음'·미판정으로 계산했습니다`);
  if (problems.length) {
    console.log("\n확인할 것:");
    for (const p of problems) console.log(` - ${p}`);
    process.exitCode = 1;
  }
}
