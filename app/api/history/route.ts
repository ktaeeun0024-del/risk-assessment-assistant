import { NextResponse } from "next/server";
import { dbErrorCode, recentHistory } from "@/lib/db";

export async function GET() {
  try {
    return NextResponse.json({ items: await recentHistory(5) });
  } catch (err) {
    console.error(`[history] 기록 조회 실패: ${dbErrorCode(err)}`);
    return NextResponse.json({ error: "기록을 불러오지 못했어요." }, { status: 503 });
  }
}
