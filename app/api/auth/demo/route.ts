// 체험 계정으로 들어가기 (11/23). 가입 없이 체험 회사의 공용 계정으로 로그인한다 (lib/demo.ts).
import { NextResponse } from "next/server";
import { authErrorResponse, checkSameOrigin, startSession, userById } from "@/lib/auth";
import { enterDemo } from "@/lib/demo";

export async function POST(request: Request) {
  try {
    checkSameOrigin(request);
    const id = await enterDemo();
    await startSession(id, request);
    return NextResponse.json({ user: await userById(id) });
  } catch (err) {
    return authErrorResponse(err, "demo");
  }
}
