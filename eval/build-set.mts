// 검증 세트 만들기: eval/cases.json(작업 설명) + 표준모델 원본 파일 → eval/eval_set.json(정답 위험요인)
// 실행: npm run eval:build
//
// - 정답 = 그 작업 원본 파일의 유해·위험요인. 거의 같은 문장(겹침 0.8 이상)은 하나로 합친다.
// - 검색에서 뺄 파일 = 원본 파일 + 정답 문장을 40% 이상 그대로 가진 다른 파일(복사본).
//   측정할 때 이 파일들을 검색에서 빼야 정답을 그대로 가져오는 일이 없다.
import { readFileSync, writeFileSync } from "node:fs";
import { CATEGORIES } from "../lib/schema";
import { STANDARD_ROWS } from "../lib/standard-models";
import { accidentTypes, bigrams, overlap } from "./match";

const DUP_GOLD = 0.8;
const COPY_SHARE = 0.4;

type CaseInput = { id: string; title: string; source: string; description: string };
const input = JSON.parse(readFileSync(new URL("./cases.json", import.meta.url), "utf8")) as {
  about: string;
  author: string;
  cases: CaseInput[];
};

const clean = (s: string) => String(s ?? "").replaceAll("_x000D_", "").replace(/\s+/g, " ").trim();
const usable = STANDARD_ROWS.filter((r) => (CATEGORIES as readonly string[]).includes(r.분류) && clean(r.유해위험요인));

const hazardsByFile = new Map<string, Set<string>>();
for (const r of usable) {
  const set = hazardsByFile.get(r.출처파일) ?? new Set<string>();
  set.add(clean(r.유해위험요인));
  hazardsByFile.set(r.출처파일, set);
}

const cases = input.cases.map((c) => {
  const rows = usable.filter((r) => r.출처파일 === c.source);
  if (!rows.length) throw new Error(`${c.id}: 원본 파일을 찾지 못함 (${c.source})`);

  const gold: { text: string; 분류: string; 세부작업: string; types: string[] }[] = [];
  for (const r of rows) {
    const text = clean(r.유해위험요인);
    const g = bigrams(text);
    if (gold.some((x) => overlap(bigrams(x.text), g) >= DUP_GOLD)) continue;
    gold.push({ text, 분류: r.분류, 세부작업: clean(r.세부작업), types: [...accidentTypes(text)] });
  }

  const own = hazardsByFile.get(c.source)!;
  const exclude = [c.source];
  for (const [file, set] of hazardsByFile) {
    if (file === c.source) continue;
    let same = 0;
    for (const h of own) if (set.has(h)) same++;
    if (same / own.size >= COPY_SHARE) exclude.push(file);
  }
  return { ...c, exclude, gold };
});

const out = {
  about: "검증 세트: 작업 설명(입력) + 표준모델 정답 위험요인. eval/cases.json과 표준모델에서 npm run eval:build로 만든다.",
  descriptionsBy: input.author,
  builtAt: new Date().toISOString().slice(0, 10),
  rules: { dupGold: DUP_GOLD, copyShare: COPY_SHARE },
  cases,
};
writeFileSync(new URL("./eval_set.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");

console.log("id   정답 유형없음 제외파일  작업");
for (const c of cases) {
  const untyped = c.gold.filter((g) => !g.types.length).length;
  console.log(`${c.id}  ${String(c.gold.length).padStart(4)} ${String(untyped).padStart(6)} ${String(c.exclude.length).padStart(7)}  ${c.title}`);
}
console.log(`합계 정답 위험요인 ${cases.reduce((a, c) => a + c.gold.length, 0)}개 → eval/eval_set.json`);
