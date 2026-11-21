// 작업 전 점검 기록 (11/24). 로그인한 회사 계정만 저장·조회한다.
//   GET  /api/checks          → 우리 회사의 최근 점검 10건
//   POST /api/checks { title, items: [{ action, task, hazard, level, done }], note } → 저장 후 최근 10건
import { NextResponse } from "next/server";
import { AuthError, authErrorResponse, checkSameOrigin, readJson, requireUser } from "@/lib/auth";
import { recentChecks, readCheck, saveCheck } from "@/lib/daily-checks";
import { dbErrorCode } from "@/lib/db";

export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json({ checks: await recentChecks(user.companyId) });
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err, "checks");
    console.error(`[checks] 점검 기록 조회 실패: ${dbErrorCode(err)}`);
    return NextResponse.json({ error: "점검 기록을 불러오지 못했어요." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    checkSameOrigin(request);
    const user = await requireUser();
    const check = readCheck(await readJson(request));
    if (!check) throw new AuthError("점검 내용이 올바르지 않아요. 다시 시도해 주세요.", 400);
    await saveCheck(user.companyId, user.id, check);
    return NextResponse.json({ checks: await recentChecks(user.companyId) });
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err, "checks");
    console.error(`[checks] 점검 기록 저장 실패: ${dbErrorCode(err)}`);
    return NextResponse.json({ error: "점검 기록을 저장하지 못했어요." }, { status: 503 });
  }
}
