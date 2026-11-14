import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { dbErrorCode } from "@/lib/db";

// 로그인 상태 확인. DB에 연결하지 못하면 dbAvailable: false로 알려서 화면이 로그인 기능을 숨기게 한다.
export async function GET() {
  try {
    return NextResponse.json({ user: await currentUser(), dbAvailable: true });
  } catch (err) {
    console.error(`[me] 로그인 상태 확인 실패: ${dbErrorCode(err)}`);
    return NextResponse.json({ user: null, dbAvailable: false });
  }
}
