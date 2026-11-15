// AI 없는 평가표 초안: 표준모델 검색 기반 (비용 0원). src/retrieve_draft.py를 옮긴 것이다.
//
// - 작업 설명을 구절로 나누고, 구절마다 표준모델에서 비슷한 위험요인을 BM25로 찾는다.
//   글자 2개씩 자른 조각(바이그램)을 써서 한국어 형태소 분석기 없이도 잘 맞는다.
// - 표준모델에 없는 설비(프레스, 솔벤트 등)는 SYNONYMS로 비슷한 위험 단어를 덧붙여 찾는다.
// - 표준모델에는 가능성·중대성 점수가 비어 있어서, 점수는 규칙으로 정한 '기본값'이다. 사람이 확인해야 한다.
//   중대성: 위험요인 문장의 사고 유형(추락·감전·끼임 → 3 등)
//   가능성: 기본 2, 설명에 '없다·안 쓴다·혼자' 같은 말이 있으면 3. 대책 후 가능성은 1.
import { CATEGORIES, extractLawRefs, type Assessment, type AssessmentItem } from "./schema";
import { STANDARD_ROWS, type StandardRow } from "./standard-models";

const PER_CLAUSE = 4; // 구절 하나당 가져올 항목 수
const MIN_SCORE = 12.0; // 이보다 낮은 점수는 관련 없다고 본다
const RELATIVE_CUT = 0.6; // 구절 안에서 1등 점수의 60% 미만은 버린다
const DUP_SIMILARITY = 0.55; // 위험요인 문장이 이만큼 겹치면 중복으로 본다
const COMMON_QUERY = "작업장 바닥 통로 넘어짐 미끄러짐 걸림 중량물 운반 요통";
const COMMON_CLAUSE = "공통(작업장 전반)";

const SYNONYMS: Record<string, string> = {
  프레스: "기계 끼임 협착 방호장치 손 끼임",
  금형: "기계 끼임 협착 중량물 낙하",
  솔벤트: "유기용제 화학물질 세척 흡입 화재",
  신너: "유기용제 화학물질 화재",
  시너: "유기용제 화학물질 화재",
  세척: "세척 유기용제 화학물질",
  연마: "연삭 그라인더 비산 회전체",
  바렐: "회전체 기계 끼임 소음",
  // '선반'은 공작기계와 물건 놓는 선반이 헷갈려서 넣지 않는다
  선반기: "회전체 말림 기계 끼임",
  밀링: "회전체 기계 끼임 비산",
  컨베이어: "기계 끼임 협착 회전체",
  소음: "소음 청력 귀마개",
  코일: "중량물 낙하 깔림",
  철판: "베임 중량물 낙하",
  페달: "기계 오작동 끼임",
  도장: "도장 유기용제 화재",
  용접: "용접 화재 흄 감전",
  분전반: "감전 누전차단기",
};

const RISKY_CUES = ["없", "안 쓰", "안 씁", "안쓰", "안 함", "미설치", "미착용", "혼자", "1대에만", "한 대만", "잘 안"];

const SEVERITY_RULES: [number, string[]][] = [
  [3, ["추락", "감전", "끼임", "끼여", "협착", "깔림", "말림", "폭발", "화재", "질식", "중독", "붕괴",
       "절단", "사망", "전복", "충돌", "부딪", "낙하", "맞음"]],
  [2, ["넘어", "미끄러", "베임", "베일", "화상", "요통", "근골격", "소음", "청력", "비산", "흡입", "찔림",
       "전도", "타박"]],
];

const WORD = /[가-힣A-Za-z0-9]+/g;
const PARTICLE = /(에서|으로|에게|까지|부터|처럼|이나|은|는|이|가|을|를|에|로|와|과|도|만|의)$/;
const VERB_ENDING = /(니다|는데|지만|어서|아서|면서|하며|하는|되는|있는|없는|았고|었고|[가-힣]{2}고)$/;
const STOPWORDS = new Set(["작업자", "직원", "공장", "회사", "사람", "오전", "오후", "한번", "정도", "하루", "그리고"]);

export const clean = (s: string) => String(s ?? "").replaceAll("_x000D_", "").replace(/\s+/g, " ").trim();
const stripNumber = (s: string) => s.replace(/^\s*(\d+(\.\d+)*[.)]?|[-·•※○])\s*/, "").trim();

function bigrams(text: string): string[] {
  const out: string[] = [];
  for (const word of String(text).match(WORD) ?? []) {
    const ch = Array.from(word);
    if (ch.length === 1) out.push(word);
    else for (let i = 0; i < ch.length - 1; i++) out.push(ch[i] + ch[i + 1]);
  }
  return out;
}

function count(terms: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of terms) m.set(t, (m.get(t) ?? 0) + 1);
  return m;
}

// 구절에서 명사 비슷한 말만 남긴다. 어미·조사·숫자가 엉뚱한 행과 맞는 것을 막는다.
// 예: '80톤 기계식 프레스 2대로 브래킷을 찍습니다' → '기계식 프레스 브래킷'
function queryTerms(clause: string): string {
  const keep: string[] = [];
  for (let w of clause.match(WORD) ?? []) {
    if (/\d/.test(w) || (VERB_ENDING.test(w) && !(w in SYNONYMS))) continue;
    if (Array.from(w).length > 2) w = w.replace(PARTICLE, "");
    if (Array.from(w).length >= 2 && !STOPWORDS.has(w)) keep.push(w);
  }
  return keep.join(" ");
}

type Index = { rows: StandardRow[]; docs: Map<string, number>[]; lens: number[]; df: Map<string, number>; avg: number };
// 검색 색인. 기본(전체 표준모델)과, 검증 측정 때 쓰는 '원본 파일 제외' 색인을 따로 캐시한다.
const cache = new Map<string, Index>();

// 검증 측정(eval/)에서만 쓴다: 평가 대상 작업의 원본 파일을 빼고 검색해야
// "처음 보는 작업"에서의 실력을 잴 수 있다 (정답을 검색으로 그대로 가져오는 것을 막음).
export type RetrieveOptions = { excludeFiles?: ReadonlySet<string> };

function index(opts: RetrieveOptions = {}): Index {
  const exclude = opts.excludeFiles;
  const key = exclude?.size ? [...exclude].sort().join("|") : "";
  const hit = cache.get(key);
  if (hit) return hit;
  const rows = STANDARD_ROWS.filter(
    (r) =>
      (CATEGORIES as readonly string[]).includes(r.분류) &&
      r.유해위험요인.trim() !== "" &&
      !exclude?.has(r.출처파일),
  );
  // 유해위험요인은 두 번 넣어 가중치를 준다
  const docs = rows.map((r) => count(bigrams([r.세부작업, r.유해위험요인, r.원인, r.유해위험요인].join(" "))));
  const lens = docs.map((d) => [...d.values()].reduce((a, b) => a + b, 0));
  const df = new Map<string, number>();
  for (const d of docs) for (const t of d.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  const avg = lens.reduce((a, b) => a + b, 0) / docs.length;
  const built = { rows, docs, lens, df, avg };
  cache.set(key, built);
  return built;
}

// BM25. [행 번호, 점수]를 점수 높은 순으로.
export function search(query: string, k: number, minScore = MIN_SCORE, opts: RetrieveOptions = {}): [number, number][] {
  const { docs, lens, df, avg } = index(opts);
  const n = docs.length;
  const q = [...count(bigrams(query)).keys()];
  const scores: [number, number][] = [];
  docs.forEach((d, i) => {
    let s = 0;
    for (const t of q) {
      const f = d.get(t) ?? 0;
      if (!f) continue;
      const dfT = df.get(t) ?? 0;
      const idf = Math.log(1 + (n - dfT + 0.5) / (dfT + 0.5));
      s += (idf * f * 2.2) / (f + 1.2 * (0.25 + (0.75 * lens[i]) / avg));
    }
    if (s >= minScore) scores.push([i, s]);
  });
  return scores.sort((a, b) => b[1] - a[1]).slice(0, k);
}

export function splitClauses(description: string): string[] {
  return description
    .split(/[.!?\n]+|,\s*|\s+(?:그리고|그 다음|끝나면)\s+/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 4);
}

const expand = (clause: string) =>
  [queryTerms(clause), ...Object.entries(SYNONYMS).filter(([k]) => clause.includes(k)).map(([, v]) => v)].join(" ");

function severity(hazard: string): number {
  for (const [level, words] of SEVERITY_RULES) if (words.some((w) => hazard.includes(w))) return level;
  return 2;
}

const likelihood = (clause: string) => (RISKY_CUES.some((c) => clause.includes(c)) ? 3 : 2);

function similar(a: string, b: string): number {
  const x = new Set(bigrams(a));
  const y = new Set(bigrams(b));
  let inter = 0;
  for (const t of x) if (y.has(t)) inter++;
  return inter / Math.max(1, Math.min(x.size, y.size));
}

const short = (s: string, n = 30) => (Array.from(s).length <= n ? s : Array.from(s).slice(0, n - 1).join("") + "…");

// 번호·기호가 붙은 줄에서만 나눈다. 엑셀 칸 안의 줄바꿈은 문장 중간일 수 있다.
export function measures(raw: string): string[] {
  const text = String(raw).replaceAll("_x000D_", "").replaceAll("\r", "");
  const parts = text.split(/\n(?=\s*(?:\d+[.)]|[-·•※○ㅇ]\s))/);
  const out = parts.map((p) => stripNumber(clean(p)).replace(/^\s*ㅇ\s+/, "")).filter(Boolean);
  return [...new Set(out)];
}

function toItem(row: StandardRow, clause: string): AssessmentItem {
  const hazard = clean(row.유해위험요인);
  const sev = severity(hazard);
  const like = likelihood(clause);
  const ms = measures(row.감소대책);
  const refs = extractLawRefs(row.관련근거);
  return {
    세부작업: short(clause),
    분류: row.분류,
    원인: stripNumber(clean(row.원인)) || "표준모델 참고",
    유해위험요인: hazard,
    관련근거: (refs.length ? refs : row.법조항).join(", "),
    현재조치: "",
    가능성: like,
    중대성: sev,
    감소대책: ms,
    // 대책을 이행하면 가능성을 1로 본다. 대책이 없으면 그대로 둔다.
    개선후가능성: ms.length ? 1 : like,
    개선후중대성: sev,
  };
}

export type Source = {
  구절: string;
  점수: number;
  표준모델_작업: string;
  표준모델_세부작업: string;
};

export function retrieveDraft(
  description: string,
  title = "",
  opts: RetrieveOptions = {},
): { assessment: Assessment; sources: Source[] } {
  const { rows } = index(opts);
  const items: AssessmentItem[] = [];
  const sources: Source[] = [];

  const add = (clause: string, hits: [number, number][]) => {
    for (const [i, score] of hits) {
      const row = rows[i];
      const hazard = clean(row.유해위험요인);
      if (items.some((it) => similar(hazard, it.유해위험요인) >= DUP_SIMILARITY)) continue;
      items.push(toItem(row, clause));
      sources.push({
        구절: clause,
        점수: Math.round(score * 10) / 10,
        표준모델_작업: clean(row.작업명),
        표준모델_세부작업: clean(row.세부작업),
      });
    }
  };

  const clauses = splitClauses(description);
  let prevStart = 0;
  for (const clause of clauses) {
    let hits = search(expand(clause), PER_CLAUSE, MIN_SCORE, opts);
    // 구절의 1등 점수보다 많이 낮은 것은 버린다 (억지로 채운 항목 방지)
    if (hits.length) hits = hits.filter((h) => h[1] >= RELATIVE_CUT * hits[0][1]);
    if (!hits.length) {
      // '방호장치는 1대에만', '반장이 혼자 합니다'처럼 찾을 게 없는 구절은
      // 바로 앞 구절의 작업을 보충하는 경우가 많다 → 앞 항목들의 가능성을 올린다
      if (likelihood(clause) === 3) for (const it of items.slice(prevStart)) it.가능성 = 3;
      continue;
    }
    prevStart = items.length;
    add(clause, hits);
  }
  add(COMMON_CLAUSE, search(COMMON_QUERY, 2, MIN_SCORE, opts));

  return {
    assessment: { 작업명: title || short(clauses[0] ?? description, 20), 항목: items },
    sources,
  };
}

// AI에게 참고 자료로 줄 표준모델 위험요인 (AI가 근거 있는 내용을 쓰도록 돕는다)
export function referenceText(sources: Source[], assessment: Assessment, limit = 15): string {
  return assessment.항목
    .slice(0, limit)
    .map((it, i) => {
      const s = sources[i];
      const ms = it.감소대책.slice(0, 3).join(" / ");
      return `- [${it.분류}] ${it.유해위험요인} (표준모델: ${s?.표준모델_작업 ?? "-"})` +
        (it.관련근거 ? ` 근거: ${it.관련근거}` : "") +
        (ms ? ` 대책: ${ms}` : "");
    })
    .join("\n");
}
