import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { db, dbErrorCode } from "@/lib/db";

// 로그인 상태 확인. DB에 연결하지 못하면 dbAvailable: false로 알려서 화면이 로그인 기능을 숨기게 한다.
// 로그인 쿠키가 없어도 DB 연결부터 확인한다 (11/23 새 환경 재실행에서 찾음: DB 없이도 로그인 버튼이 보였음)
export async function GET() {
  try {
    await db();
    return NextResponse.json({ user: await currentUser(), dbAvailable: true });
  } catch (err) {
    console.error(`[me] 로그인 상태 확인 실패: ${dbErrorCode(err)}`);
    return NextResponse.json({ user: null, dbAvailable: false });
  }
}
