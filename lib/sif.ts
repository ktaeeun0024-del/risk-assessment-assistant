// 비슷한 사망사고 사례 (11/22): 안전보건공단 「사망사고 고위험요인(SIF) 아카이브」에서
// 평가표 항목과 비슷한 실제 사망·중상 사례를 찾아 보여 준다. AI 없이 BM25 검색 (비용 0원).
// '이 위험이 실제로 사람을 죽였다'는 것을 보여 줘서 감소대책을 미루지 않게 하려는 것.
// 데이터는 scripts/download-sif.mts로 받는다 (data/sif_cases.json). 서버에서만 쓴다.
import raw from "@/data/sif_cases.json";
import { bigrams } from "./retrieve";

export type SifCase = {
  구분: string;
  업종: string;
  작업: string;
  단위작업: string;
  재해종류: string;
  개요: string;
  기인물: string;
  고위험상황: string;
  유발요인: string;
  감소대책: string;
};

export type SifQueryItem = { 세부작업: string; 원인: string; 유해위험요인: string; 점수: number };
export type SifMatch = { case: SifCase; item: string; score: number };

const CASES = raw as SifCase[];
const MIN_SCORE = 22; // 이보다 낮으면 비슷하지 않다고 본다 (검증 세트 20종 + 예시로 사례를 직접 읽어 보며 정함)

// 사고 유형. 글자만 겹치고 사고가 다른 짝(예: '바닥 물기로 미끄러짐' ↔ '옥상에서 추락')을 막는다.
// 항목과 사례 모두 유형을 알 수 있는데 하나도 겹치지 않으면 짝짓지 않는다.
const ACCIDENT_TYPES: [string, RegExp][] = [
  ["추락", /추락|떨어져|떨어짐|실족/],
  ["넘어짐", /넘어|미끄러|걸려/],
  ["끼임", /끼임|끼여|끼어|협착|말림|말려|감김|감겨/],
  ["감전", /감전|충전부|충전전로|아크|누전/],
  ["화재·폭발", /화재|폭발|화염|인화|발화|점화/],
  ["깔림·무너짐", /깔림|깔려|전도|전복|넘어지|무너|붕괴|도괴/],
  ["맞음", /맞음|맞아|낙하|비래|튕겨|날아|파편/],
  ["부딪힘", /부딪|충돌|치임|치여|받힘/],
  ["질식·중독", /질식|중독|산소결핍|산소부족|유해가스|황화수소|일산화탄소/],
  ["화상", /화상|고온|증기|뜨거운/],
  ["베임", /베임|베여|찔림|찔려|절단되/],
  ["화학물질", /누출|접촉|피부|흡입|화학물질/],
];
const typesOf = (text: string) => new Set(ACCIDENT_TYPES.filter(([, re]) => re.test(text)).map(([t]) => t));
const disjoint = (a: Set<string>, b: Set<string>) => a.size > 0 && b.size > 0 && ![...a].some((t) => b.has(t));
const MAX_ITEMS = 10; // 위험성 높은 항목부터 이만큼만 찾는다
export const SIF_SOURCE = "안전보건공단 사망사고 고위험요인(SIF) 아카이브 (공공데이터포털, 이용 제한 없음)";

type Index = { docs: Map<string, number>[]; lens: number[]; df: Map<string, number>; avg: number; types: Set<string>[] };
let cached: Index | null = null;

function count(terms: string[]) {
  const m = new Map<string, number>();
  for (const t of terms) m.set(t, (m.get(t) ?? 0) + 1);
  return m;
}

function index(): Index {
  if (cached) return cached;
  // 기인물·유발요인은 두 번 넣어 가중치를 준다 (무엇이 어떻게 사고를 냈나)
  const docs = CASES.map((c) => count(bigrams([c.단위작업, c.개요, c.기인물, c.기인물, c.고위험상황, c.유발요인, c.유발요인].join(" "))));
  const lens = docs.map((d) => [...d.values()].reduce((a, b) => a + b, 0));
  const df = new Map<string, number>();
  for (const d of docs) for (const t of d.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  const types = CASES.map((c) => typesOf(`${c.개요} ${c.유발요인}`));
  cached = { docs, lens, df, avg: lens.reduce((a, b) => a + b, 0) / Math.max(1, docs.length), types };
  return cached;
}

function best(query: string, hazard: string): [number, number] | null {
  const { docs, lens, df, avg, types } = index();
  const want = typesOf(hazard);
  const n = docs.length;
  const q = [...count(bigrams(query)).keys()];
  let top: [number, number] | null = null;
  docs.forEach((d, i) => {
    if (disjoint(want, types[i])) return;
    let s = 0;
    for (const t of q) {
      const f = d.get(t) ?? 0;
      if (!f) continue;
      const dfT = df.get(t) ?? 0;
      s += (Math.log(1 + (n - dfT + 0.5) / (dfT + 0.5)) * f * 2.2) / (f + 1.2 * (0.25 + (0.75 * lens[i]) / avg));
    }
    if (s >= MIN_SCORE && (!top || s > top[1])) top = [i, s];
  });
  return top;
}

export const sifReady = () => CASES.length > 0;

// 항목마다 가장 비슷한 사례 하나 → 같은 사례는 한 번만 → 점수 높은 순으로 최대 k개
export function similarCases(items: SifQueryItem[], k = 3): SifMatch[] {
  if (!sifReady()) return [];
  const picked = new Map<number, SifMatch>();
  const common = new Set<number>();
  const ordered = [...items].sort((a, b) => b.점수 - a.점수).slice(0, MAX_ITEMS);
  for (const it of ordered) {
    const hit = best([it.세부작업, it.원인, it.유해위험요인, it.유해위험요인].join(" "), `${it.원인} ${it.유해위험요인}`);
    if (!hit) continue;
    const [i, score] = hit;
    const prev = picked.get(i);
    if (!prev || score > prev.score) picked.set(i, { case: CASES[i], item: it.유해위험요인, score });
    if (it.세부작업.startsWith("공통")) common.add(i);
  }
  // 더 비슷한 순. 검색 초안에 늘 붙는 공통 항목('바닥 물기로 넘어짐' 등)의 사례는 맨 뒤로 보내 자리를 차지하지 않게 한다
  return [...picked.entries()]
    .sort(([ia, a], [ib, b]) => Number(common.has(ia)) - Number(common.has(ib)) || b.score - a.score)
    .slice(0, k)
    .map(([, m]) => m);
}
