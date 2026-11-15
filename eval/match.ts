// 검증 채점: AI·검색 초안의 위험요인이 정답(표준모델) 위험요인을 얼마나 찾았는지 코드로 판단한다.
// 돈이 드는 AI 채점 없이, 같은 입력이면 언제나 같은 점수가 나온다.
//
// 짝짓기는 1:1이다. 초안 항목 하나가 정답 여러 개를 동시에 맞힌 것으로 치지 않는다
// (예: "사다리에서 추락" 한 줄이 원인이 다른 추락 위험 6개를 모두 맞힌 것으로 세지 않음).
// 가능한 짝을 겹침이 큰 순서로 정렬해 앞에서부터 짝짓는다.
//
// 같은 위험요인으로 보는 기준 (둘 중 하나)
//  1) 사고 유형(끼임·추락·감전 …)이 하나 이상 같고, 사고 유형 말을 뺀 나머지(대상·원인) 조각이
//     TYPE_OVERLAP 이상 겹친다. 유형 말("미끄러져" 등)까지 세면 '바닥에서 미끄러짐'과
//     '사다리가 미끄러짐'처럼 다른 위험이 같다고 나와서 뺀다.
//  2) 사고 유형과 상관없이 글자 조각이 TEXT_OVERLAP 이상 겹친다 (거의 같은 문장)
// 겹침 = 공통 조각 수 / 둘 중 짧은 쪽의 조각 수. '위험·발생·인한' 같은 흔한 말은 조각에서 뺀다.
//
// 한계: 말이 아주 다르면 같은 위험도 놓친다 (예: '솥에서 튀어 화상' ↔ '고온 증기에 화상').
// 그래서 사고 유형 재현율을 함께 본다. 채점이 맞는지는 표본을 사람이 직접 확인한다 (eval/README.md).

export const TYPE_OVERLAP = 0.2;
export const TEXT_OVERLAP = 0.6;

// 사고 유형: 산업재해 통계에서 쓰는 발생 형태를 현장 말로 묶은 것
export const ACCIDENT_TYPES: [string, RegExp][] = [
  ["끼임", /끼임|끼여|끼일|협착|말림|감김|물림/],
  ["떨어짐", /추락|떨어짐|떨엄짐|떨어져|떨어질/],
  ["넘어짐", /넘어짐|넘어질|넘어져|미끄러|걸려|헛디|접질|접지름|발목/],
  ["부딪힘", /부딪|충돌|타격|접촉사고/],
  ["맞음", /맞음|낙하|비래|날아|파편|물체에/],
  ["무너짐", /붕괴|무너|도괴/],
  ["깔림·뒤집힘", /깔림|전도|전복|넘어지거나|굴러|뒤집/],
  ["감전", /감전|누전|충전부|활선|전류|고압선|전선관/],
  ["화재·폭발", /화재|폭발|인화|불티|역화|스파크|화기/],
  ["화상", /화상|고온|증기|급탕|열사병/],
  ["유해물질", /흡입|중독|화학|약품|시약|유해|흄|가스노출|누출|피부|눈 또는|분진|먼지|표백제|냉매|용제|도장물질|프라이머|에폭시|방사선|피폭|방사능/],
  ["질식", /질식|산소부족|산소결핍|밀폐공간/],
  ["베임·찔림", /베임|베일|찔림|절단|가시|열상|칼/],
  ["근골격계", /근골격|요통|허리|중량물.*(취급|운반|이동)|무리한 동작|반복작업|자세/],
  ["소음", /소음|청력/],
  ["온열·한랭", /열사병|온열|한랭|폭염|고온 작업환경/],
  ["교통사고", /차량사고|교통|과속|도로|운전미숙|주행/],
  ["감염", /감염|전염|곤충|벌쏘임|동물매개|음식물 쓰레기/],
];

// 사고 유형을 나타내는 말들 (대상·원인 겹침을 잴 때 뺀다)
const TYPE_WORDS = ACCIDENT_TYPES.flatMap(([, re]) => re.source.split("|")).filter((w) => !/[.*()\\]/.test(w));

const WORD = /[가-힣A-Za-z0-9]+/g;
// 거의 모든 위험요인 문장에 나오는 조각 (점수를 부풀리므로 뺀다)
const STOP = new Set([
  "위험", "발생", "인한", "으로", "인해", "사고", "작업", "작업자", "근로", "로자", "업자", "등의", "부상",
  "상해", "가능", "가능성", "에서", "에의", "의한", "시에", "하여", "하는", "되어", "되는", "있는", "없는",
  "로인", "중에", "작업중", "업중", "업시", "작업시",
]);

export function bigrams(text: string): Set<string> {
  const out = new Set<string>();
  for (const word of String(text).match(WORD) ?? []) {
    const ch = Array.from(word);
    if (ch.length === 1) continue;
    for (let i = 0; i < ch.length - 1; i++) {
      const b = ch[i] + ch[i + 1];
      if (!STOP.has(b)) out.add(b);
    }
  }
  return out;
}

export function accidentTypes(text: string): Set<string> {
  const types = new Set<string>();
  for (const [name, re] of ACCIDENT_TYPES) if (re.test(text)) types.add(name);
  return types;
}

export function overlap(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / Math.min(a.size, b.size);
}

export type Hazard = { text: string; types: Set<string>; grams: Set<string>; objectGrams: Set<string> };

const stripTypeWords = (text: string) => TYPE_WORDS.reduce((t, w) => t.replaceAll(w, " "), text);

export const toHazard = (text: string): Hazard => ({
  text,
  types: accidentTypes(text),
  grams: bigrams(text),
  objectGrams: bigrams(stripTypeWords(text)),
});

export function sameHazard(a: Hazard, b: Hazard): { ok: boolean; score: number } {
  const text = overlap(a.grams, b.grams);
  const shareType = [...a.types].some((t) => b.types.has(t));
  const object = shareType ? overlap(a.objectGrams, b.objectGrams) : 0;
  const ok = (shareType && object >= TYPE_OVERLAP) || text >= TEXT_OVERLAP;
  return { ok, score: Math.max(text, object) };
}

export type CaseScore = {
  goldCount: number;
  predCount: number;
  hazardRecall: number; // 정답 위험요인 중 찾은 비율
  typeRecall: number; // 정답에 나온 사고 유형 중 초안에도 나온 비율
  matchedPredRate: number; // 초안 항목 중 정답과 겹친 비율 (나머지가 틀렸다는 뜻은 아님)
  found: { gold: string; pred: string; score: number }[];
  missed: string[];
  missedTypes: string[];
};

export function scoreCase(gold: string[], pred: string[]): CaseScore {
  const G = gold.map(toHazard);
  const P = pred.map(toHazard);
  // 가능한 짝을 모두 구해 겹침이 큰 순서로 1:1로 짝짓는다
  const pairs: { g: number; p: number; score: number }[] = [];
  G.forEach((g, gi) =>
    P.forEach((p, pi) => {
      const m = sameHazard(g, p);
      if (m.ok) pairs.push({ g: gi, p: pi, score: m.score });
    }),
  );
  pairs.sort((a, b) => b.score - a.score);
  const goldTaken = new Map<number, { p: number; score: number }>();
  const usedPred = new Set<number>();
  for (const pr of pairs) {
    if (goldTaken.has(pr.g) || usedPred.has(pr.p)) continue;
    goldTaken.set(pr.g, { p: pr.p, score: pr.score });
    usedPred.add(pr.p);
  }
  const found: CaseScore["found"] = [];
  const missed: string[] = [];
  G.forEach((g, gi) => {
    const t = goldTaken.get(gi);
    if (t) found.push({ gold: g.text, pred: P[t.p].text, score: Math.round(t.score * 100) / 100 });
    else missed.push(g.text);
  });
  const goldTypes = new Set(G.flatMap((g) => [...g.types]));
  const predTypes = new Set(P.flatMap((p) => [...p.types]));
  const missedTypes = [...goldTypes].filter((t) => !predTypes.has(t));
  return {
    goldCount: G.length,
    predCount: P.length,
    hazardRecall: G.length ? found.length / G.length : 0,
    typeRecall: goldTypes.size ? (goldTypes.size - missedTypes.length) / goldTypes.size : 0,
    matchedPredRate: P.length ? usedPred.size / P.length : 0,
    found,
    missed,
    missedTypes,
  };
}
