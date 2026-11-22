// 우리 회사 평가표 기록. 회사는 로그인 세션에서만 정한다 (요청에 회사 번호를 받지 않는다).
//   GET  /api/history                 → { items: 최근 평가표 }
//   POST /api/history { id, daily }   → 매일 점검에 쓰기/해제 (11/22) 후 { items }
import { NextResponse } from "next/server";
import { AuthError, authErrorResponse, checkSameOrigin, readJson, requireUser } from "@/lib/auth";
import { dbErrorCode } from "@/lib/db";
import { recentHistory, setDaily } from "@/lib/history";

export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json({ items: await recentHistory(user.companyId) });
  } catch (err) {
    if (typeof err === "object" && err !== null && "status" in err) return authErrorResponse(err, "history");
    console.error(`[history] 기록 조회 실패: ${dbErrorCode(err)}`);
    return NextResponse.json({ error: "기록을 불러오지 못했어요." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    checkSameOrigin(request);
    const user = await requireUser();
    const body = await readJson(request);
    const id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0 || typeof body.daily !== "boolean") throw new AuthError("잘못된 요청입니다.", 400);
    if (!(await setDaily(user.companyId, id, body.daily))) throw new AuthError("우리 회사 평가표가 아니에요.", 404);
    return NextResponse.json({ items: await recentHistory(user.companyId) });
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err, "history");
    console.error(`[history] 매일 점검 설정 실패: ${dbErrorCode(err)}`);
    return NextResponse.json({ error: "매일 점검 설정을 바꾸지 못했어요." }, { status: 503 });
  }
}
