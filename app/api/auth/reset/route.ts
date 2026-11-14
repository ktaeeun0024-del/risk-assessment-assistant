// 비밀번호 찾기 1단계: 가입된 이메일이면 인증번호를 보낸다.
// 가입 여부를 알려 주지 않으려고, 가입되지 않은 이메일이나 너무 잦은 요청에도 같은 답을 준다.
import { NextResponse } from "next/server";
import { AuthError, authErrorResponse, checkSameOrigin, normalizeEmail, readJson } from "@/lib/auth";
import { CODE_MINUTES, sendCode } from "@/lib/codes";
import { db } from "@/lib/db";
import { siteUrl } from "@/lib/mail";

export async function POST(request: Request) {
  try {
    checkSameOrigin(request);
    const email = normalizeEmail((await readJson(request)).email);
    const { rows } = await (await db()).query(`SELECT name FROM users WHERE email = $1`, [email]);
    if (rows[0]) {
      await sendCode({
        purpose: "reset",
        email,
        subject: "비밀번호 재설정 인증번호",
        intro: `${rows[0].name}님, 비밀번호를 다시 정하기 위한 인증번호예요.`,
        link: siteUrl(request),
      }).catch((err) => {
        if (err instanceof AuthError && err.status === 429) return; // 너무 잦은 요청도 같은 답
        throw err;
      });
    }
    return NextResponse.json({ ok: true, email, minutes: CODE_MINUTES.reset });
  } catch (err) {
    return authErrorResponse(err, "reset");
  }
}
