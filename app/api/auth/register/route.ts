// 회사 가입 1단계: 입력을 확인하고 이메일로 인증번호를 보낸다.
// 아직 회사·계정은 만들지 않는다. 입력 내용(비밀번호는 암호화한 값)은 인증번호와 함께 잠시 보관한다.
// 2단계는 /api/auth/register/verify.
// 사이트 관리자 이메일(SITE_ADMIN_EMAILS)은 사업자등록번호 없이 이메일 인증만으로 '사이트 운영' 계정을 만든다.
import { NextResponse } from "next/server";
import {
  AuthError,
  authErrorResponse,
  checkNewPassword,
  checkSameOrigin,
  cleanName,
  hashPassword,
  isSiteAdminEmail,
  normalizeEmail,
  readJson,
} from "@/lib/auth";
import { normalizeBusinessNumber } from "@/lib/business";
import { CODE_MINUTES, sendCode } from "@/lib/codes";
import { db } from "@/lib/db";
import { siteUrl } from "@/lib/mail";

export async function POST(request: Request) {
  try {
    checkSameOrigin(request);
    const body = await readJson(request);
    const email = normalizeEmail(body.email);
    const siteAdmin = isSiteAdminEmail(email);
    const companyName = siteAdmin
      ? (typeof body.companyName === "string" && body.companyName.trim()) || "사이트 운영"
      : cleanName(body.companyName, "회사 이름", 80);
    const rawNumber = typeof body.businessNumber === "string" ? body.businessNumber.trim() : "";
    const businessNumber = siteAdmin && !rawNumber ? null : normalizeBusinessNumber(rawNumber);
    const name = cleanName(body.name, "이름");
    const password = checkNewPassword(body.password, body.passwordConfirm);

    const pool = await db();
    const taken = await pool.query(`SELECT 1 FROM users WHERE email = $1`, [email]);
    if (taken.rowCount) throw new AuthError("이미 가입된 이메일이에요. 로그인해 주세요.", 409);
    const dup = businessNumber
      ? await pool.query(`SELECT status FROM companies WHERE business_number = $1 AND status <> 'rejected'`, [businessNumber])
      : { rowCount: 0, rows: [] };
    if (dup.rowCount) {
      throw new AuthError(
        dup.rows[0].status === "pending"
          ? "이 사업자등록번호로 이미 가입 신청이 들어와 승인을 기다리고 있어요."
          : "이 사업자등록번호로 이미 가입된 회사가 있어요. 회사 관리자에게 직원 초대를 요청해 주세요.",
        409,
      );
    }

    await sendCode({
      purpose: "register",
      email,
      payload: { companyName, businessNumber, name, passwordHash: await hashPassword(password) },
      subject: "회사 가입 인증번호",
      intro: siteAdmin
        ? `${name}님, 사이트 관리자 계정을 만들기 위한 이메일 인증번호예요.`
        : `${name}님, '${companyName}' 회사 가입을 위한 이메일 인증번호예요.`,
      link: siteUrl(request),
    });
    return NextResponse.json({ ok: true, email, minutes: CODE_MINUTES.register });
  } catch (err) {
    return authErrorResponse(err, "register");
  }
}
