import { NextResponse } from "next/server";
import {
  AuthError,
  authErrorResponse,
  checkLogin,
  checkSameOrigin,
  normalizeEmail,
  readJson,
  startSession,
  userById,
} from "@/lib/auth";

export async function POST(request: Request) {
  try {
    checkSameOrigin(request);
    const body = await readJson(request);
    const password = typeof body.password === "string" ? body.password : "";
    let email: string;
    try {
      email = normalizeEmail(body.email);
    } catch {
      throw new AuthError("이메일 또는 비밀번호가 맞지 않아요.", 401);
    }
    if (!password) throw new AuthError("비밀번호를 입력해 주세요.", 400);
    const { id } = await checkLogin(email, password);
    await startSession(id, request);
    return NextResponse.json({ user: await userById(id) });
  } catch (err) {
    return authErrorResponse(err, "login");
  }
}
