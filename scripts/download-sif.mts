// 안전보건공단 「사망사고 고위험요인(SIF) 아카이브」를 내려받아 data/sif_cases.json으로 저장한다 (11/22).
// 공공데이터포털 15161362, 이용허락범위 제한 없음.
// 재해개요 검색어에 '%'를 넣으면 전체가 나온다. 구분 1 = 전업종(제조업 등), 0 = 건설업.
// 반장노트는 공장용이라 전업종만 받는다 (11/22 기준 2,573건).
// 실행: npm run data:sif   (키: .env의 DATA_GO_KR_KEY 또는 NTS_SERVICE_KEY. 포털에서 이 API 활용신청이 되어 있어야 한다)
import { readFileSync, writeFileSync } from "node:fs";

const ENDPOINT = "https://apis.data.go.kr/B552468/sifArchive/view";
const CATEGORY = "1"; // 전업종
const PAGE = 100;

type Item = Record<string, string | null | undefined>;
type SifCase = {
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

function key(): string {
  if (process.env.DATA_GO_KR_KEY) return process.env.DATA_GO_KR_KEY;
  if (process.env.NTS_SERVICE_KEY) return process.env.NTS_SERVICE_KEY;
  try {
    const m = readFileSync(".env", "utf8").match(/^(?:DATA_GO_KR_KEY|NTS_SERVICE_KEY)=(.*)$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  } catch {}
  throw new Error("공공데이터포털 키가 없어요 (.env의 DATA_GO_KR_KEY 또는 NTS_SERVICE_KEY)");
}

const text = (v: unknown) => String(v ?? "").replace(/_x000D_/g, "").replace(/\s+/g, " ").trim();
// 대책은 줄마다 '▶'로 나뉘어 있어 줄바꿈을 살린다
const lines = (v: unknown) =>
  String(v ?? "")
    .split(/\n|▶/)
    .map(text)
    .filter(Boolean)
    .join("\n");

async function page(serviceKey: string, pageNo: number) {
  const url = new URL(ENDPOINT);
  const params = { serviceKey, callApiId: "1170", cateSeCd: CATEGORY, disasterOverview: "%", pageNo: String(pageNo), numOfRows: String(PAGE) };
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  const body = await res.text();
  let data: any;
  try {
    data = JSON.parse(body);
  } catch {
    throw new Error(`JSON이 아닌 응답 (${res.status}): ${body.slice(0, 200)}`);
  }
  const err = data?.OpenAPI_ServiceResponse?.cmmMsgHeader;
  if (err) throw new Error(`${err.errMsg} (${err.returnAuthMsg})`);
  const b = data?.response?.body ?? data?.body ?? {};
  let items = b?.items?.item ?? [];
  if (!Array.isArray(items)) items = items ? [items] : [];
  return { items: items as Item[], total: Number(b?.totalCount ?? 0) };
}

const toCase = (it: Item): SifCase => ({
  구분: text(it.cateSeNm),
  업종: text(it.sifLclsfNm),
  작업: text(it.sifMclsfNm),
  단위작업: text(it.sifSclsfNm),
  재해종류: text(it.disasterType),
  개요: text(it.disasterOverview),
  기인물: text(it.orgtNm),
  고위험상황: text(it.situation),
  유발요인: text(it.disasterFactor),
  감소대책: lines(it.dcrsCntrplnCn),
});

async function main() {
  const serviceKey = key();
  const seen = new Map<string, SifCase>();
  let total = 0;
  for (let p = 1; p <= 100; p++) {
    const res = await page(serviceKey, p);
    total = res.total;
    for (const it of res.items) {
      const c = toCase(it);
      if (c.개요) seen.set(`${c.개요}|${c.기인물}|${c.유발요인}`, c);
    }
    process.stdout.write(`\r${p}쪽 · 모은 사례 ${seen.size} / 전체 ${total}   `);
    if (res.items.length < PAGE || p * PAGE >= total) break;
  }
  const cases = [...seen.values()];
  writeFileSync("data/sif_cases.json", JSON.stringify(cases));
  console.log(`\n저장: data/sif_cases.json · ${cases.length}건 (API 전체 ${total}건, 같은 사례는 하나로)`);
}

main().catch((err) => {
  console.error(`\n실패: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
