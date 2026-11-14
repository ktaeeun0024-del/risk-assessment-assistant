import { NextResponse } from "next/server";
import { authErrorResponse, checkSameOrigin, endSession } from "@/lib/auth";

export async function POST(request: Request) {
  try {
    checkSameOrigin(request);
    await endSession();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorResponse(err, "logout");
  }
}
