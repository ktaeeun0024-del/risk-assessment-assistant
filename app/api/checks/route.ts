// 작업 전 점검 기록. 로그인한 회사 계정만 저장·조회한다. 회사는 로그인 세션에서만 정한다.
//   GET /api/checks?view=today          → { today: [매일 점검 평가표와 오늘 점검 여부] }
//   GET /api/checks                     → { checks: 최근 20건 }
//   GET /api/checks?history=<평가표 번호> → { checks: 그 평가표의 최근 10건, misses: 자주 못 하는 대책 }
//   GET /api/checks?id=<점검 번호>        → { check: 항목별 결과까지 }
//   GET /api/checks?format=csv&month=YYYY-MM → 한 달치 CSV (엑셀용)
//   POST /api/checks { historyId?, title, items: [{ action, task, hazard, level, done }], note } → 저장 후 최근 20건
import { NextResponse } from "next/server";
import { AuthError, authErrorResponse, checkSameOrigin, readJson, requireUser } from "@/lib/auth";
import {
  checkDetail,
  checksCsv,
  checksForMonth,
  frequentMisses,
  recentChecks,
  readCheck,
  saveCheck,
  todayStatus,
} from "@/lib/daily-checks";
import { dbErrorCode } from "@/lib/db";

const positiveInt = (v: string | null) => (v && /^\d{1,9}$/.test(v) && Number(v) > 0 ? Number(v) : null);

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const url = new URL(request.url);
    const q = url.searchParams;

    if (q.get("view") === "today") return NextResponse.json({ today: await todayStatus(user.companyId) });

    if (q.get("format") === "csv") {
      const month = q.get("month") ?? "";
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new AuthError("내려받을 달을 다시 골라 주세요.", 400);
      const csv = checksCsv(await checksForMonth(user.companyId, month));
      return new NextResponse(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="daily-checks-${month}.csv"`,
          "Cache-Control": "no-store",
        },
      });
    }

    if (q.has("id")) {
      const id = positiveInt(q.get("id"));
      const check = id ? await checkDetail(user.companyId, id) : null;
      if (!check) throw new AuthError("점검 기록을 찾지 못했어요.", 404);
      return NextResponse.json({ check });
    }

    if (q.has("history")) {
      const historyId = positiveInt(q.get("history"));
      if (!historyId) throw new AuthError("평가표를 다시 골라 주세요.", 400);
      const [checks, misses] = await Promise.all([
        recentChecks(user.companyId, { historyId, limit: 10 }),
        frequentMisses(user.companyId, historyId),
      ]);
      return NextResponse.json({ checks, misses });
    }

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
