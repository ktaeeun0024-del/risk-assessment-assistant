// 우리 회사 평가표 기록. 회사는 로그인 세션에서만 정한다 (요청에 회사 번호를 받지 않는다).
import { NextResponse } from "next/server";
import { authErrorResponse, requireUser } from "@/lib/auth";
import { dbErrorCode } from "@/lib/db";
import { recentHistory } from "@/lib/history";

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
