// 회사 가입 1단계: 입력을 확인하고 이메일로 인증번호를 보낸다.
// 아직 회사·계정은 만들지 않는다. 입력 내용(비밀번호는 암호화한 값)은 인증번호와 함께 잠시 보관한다.
// 2단계는 /api/auth/register/verify.
// 사이트 관리자 이메일(SITE_ADMIN_EMAILS)은 사업자등록번호 없이 이메일 인증만으로 '사이트 운영' 계정을 만든다.
// (11/18) 회사 가입은 사업자등록증의 대표자 성명·개업일자로 국세청 진위확인을 한다. 신청자가 대표일 필요는 없다.
//   불일치면 신청을 받지 않는다. 국세청에 연결하지 못하면 '확인 못 함'으로 받고 사이트 관리자가 판단한다.
//   같은 번호로 승인된 회사가 있으면 막고 사이트 관리자에게 알린다. 승인 대기끼리는 막지 않는다(번호 선점 방지).
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
  siteAdminEmails,
} from "@/lib/auth";
import { formatBusinessNumber, normalizeBusinessNumber, normalizeStartDate, validateWithNts } from "@/lib/business";
import { CODE_MINUTES, sendCode } from "@/lib/codes";
import { db } from "@/lib/db";
import { sendMail, siteUrl } from "@/lib/mail";

const NTS_TRIES_PER_HOUR = 5;

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
    // 진위확인 칸 (사이트 관리자 계정은 번호가 없으면 받지 않는다)
    const repName = businessNumber ? cleanName(body.repName, "대표자 성명") : null;
    const startDate = businessNumber ? normalizeStartDate(body.startDate) : null;
    const rawTitle = typeof body.applicantTitle === "string" ? body.applicantTitle.trim() : "";
    const applicantTitle = rawTitle ? cleanName(rawTitle, "직책", 30) : null;
    const password = checkNewPassword(body.password, body.passwordConfirm);

    const pool = await db();
    const taken = await pool.query(`SELECT 1 FROM users WHERE email = $1`, [email]);
    if (taken.rowCount) throw new AuthError("이미 가입된 이메일이에요. 로그인해 주세요.", 409);

    let ntsValidate = null;
    if (businessNumber) {
      const approved = await pool.query(
        `SELECT 1 FROM companies WHERE business_number = $1 AND status = 'approved'`,
        [businessNumber],
      );
      if (approved.rowCount) {
        // 우리 회사가 가입한 적이 없다면 누군가 번호를 쓴 것일 수 있다 → 사이트 관리자에게 알린다 (실패해도 무시)
        const text = [
          "이미 승인된 회사의 사업자등록번호로 새 가입 신청이 들어왔다가 막혔어요.",
          "",
          `사업자등록번호: ${formatBusinessNumber(businessNumber)}`,
          `신청한 회사 이름: ${companyName}`,
          `신청자: ${name} <${email}>`,
          "",
          "같은 회사 직원이면 회사 관리자의 초대로 가입하면 돼요. 다른 사람이 번호를 쓴 것이라면 승인된 회사를 확인해 주세요.",
        ].join("\n");
        await Promise.allSettled(siteAdminEmails().map((to) => sendMail(to, "이미 가입된 사업자번호로 가입 시도", text)));
        throw new AuthError(
          "이 사업자등록번호로 이미 가입된 회사가 있어요. 같은 회사라면 회사 관리자에게 직원 초대를 요청해 주세요. 우리 회사가 가입한 적이 없다면 사이트 관리자에게 알려 주세요.",
          409,
        );
      }

      // 진위확인: 번호 하나에 1시간 5번까지
      const tries = await pool.query(
        `SELECT count(*)::int AS n FROM nts_attempts WHERE business_number = $1 AND created_at > now() - interval '1 hour'`,
        [businessNumber],
      );
      if (tries.rows[0].n >= NTS_TRIES_PER_HOUR) {
        throw new AuthError("이 사업자등록번호로 확인을 너무 많이 시도했어요. 1시간 뒤에 다시 해 주세요.", 429);
      }
      await pool.query(`INSERT INTO nts_attempts (business_number) VALUES ($1)`, [businessNumber]);
      await pool.query(`DELETE FROM nts_attempts WHERE created_at < now() - interval '1 day'`);
      ntsValidate = await validateWithNts(businessNumber, startDate!, repName!);
      if (ntsValidate.result === "불일치") {
        throw new AuthError(
          "사업자등록증의 대표자 성명·개업일자와 맞지 않아요. 사업자등록증에 적힌 그대로 입력해 주세요. 공동대표면 한 명만 넣으면 돼요.",
          400,
        );
      }
    }

    await sendCode({
      purpose: "register",
      email,
      payload: {
        companyName,
        businessNumber,
        name,
        repName,
        startDate,
        applicantTitle,
        ntsValidate,
        passwordHash: await hashPassword(password),
      },
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
