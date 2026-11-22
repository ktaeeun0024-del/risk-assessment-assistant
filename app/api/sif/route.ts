// 비슷한 사망사고 사례 (안전보건공단 SIF 아카이브). 공공 데이터 검색이라 로그인 없이 쓴다.
//   POST /api/sif { items: [{ 세부작업, 원인, 유해위험요인, 점수 }] } → { cases: [{ case, item, score }], source }
import { NextResponse } from "next/server";
import { AuthError, authErrorResponse, checkSameOrigin, readJson } from "@/lib/auth";
import { SIF_SOURCE, similarCases, type SifQueryItem } from "@/lib/sif";

const MAX_ITEMS = 40;
const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

export async function POST(request: Request) {
  try {
    checkSameOrigin(request);
    const body = await readJson(request);
    if (!Array.isArray(body.items)) throw new AuthError("잘못된 요청입니다.", 400);
    const items: SifQueryItem[] = body.items.slice(0, MAX_ITEMS).map((raw: unknown) => {
      const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
      const 점수 = typeof r.점수 === "number" && r.점수 >= 1 && r.점수 <= 9 ? r.점수 : 1;
      return { 세부작업: str(r.세부작업, 200), 원인: str(r.원인, 300), 유해위험요인: str(r.유해위험요인, 300), 점수 };
    });
    return NextResponse.json({ cases: similarCases(items), source: SIF_SOURCE });
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err, "sif");
    console.error("[sif] 사례 검색 실패");
    return NextResponse.json({ error: "사례를 찾지 못했어요." }, { status: 500 });
  }
}
