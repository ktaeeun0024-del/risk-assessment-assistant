// 회사 가입 2단계: 인증번호를 확인하고 회사(승인 대기)와 관리자 계정을 만든다.
// 국세청 사업자등록 상태를 조회해 1단계의 진위확인 결과와 함께 저장하고, 사이트 관리자에게 승인 요청 메일을 보낸다.
// 사이트 관리자 이메일로 가입하면 (사업자등록번호 없이도) 바로 승인하고 로그인한다.
import { NextResponse } from "next/server";
import {
  AuthError,
  authErrorResponse,
  checkSameOrigin,
  isSiteAdminEmail,
  normalizeEmail,
  readJson,
  siteAdminEmails,
  startSession,
  userById,
} from "@/lib/auth";
import { checkWithNts, formatBusinessNumber } from "@/lib/business";
import { checkCode, claimCode } from "@/lib/codes";
import { dbErrorCode, transaction } from "@/lib/db";
import { sendMail, siteUrl } from "@/lib/mail";

export async function POST(request: Request) {
  try {
    checkSameOrigin(request);
    const body = await readJson(request);
    const email = normalizeEmail(body.email);
    const row = await checkCode("register", email, body.code);
    const { companyName, name, passwordHash } = row.payload as Record<string, string>;
    const businessNumber = (row.payload.businessNumber as string | null) ?? null;
    const extra = row.payload as { repName?: string | null; startDate?: string | null; applicantTitle?: string | null; ntsValidate?: unknown };

    const nts = businessNumber ? await checkWithNts(businessNumber) : null;
    const autoApprove = isSiteAdminEmail(email);

    const userId = await transaction(async (client) => {
      await claimCode(client, row.id);
      const company = await client.query(
        `INSERT INTO companies (name, business_number, status, nts_check, reviewed_at, reviewed_by,
                                rep_name, start_date, applicant_title, nts_validate)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [
          companyName,
          businessNumber,
          autoApprove ? "approved" : "pending",
          nts,
          autoApprove ? new Date() : null,
          autoApprove ? "(사이트 관리자 계정)" : null,
          extra.repName ?? null,
          extra.startDate ?? null,
          extra.applicantTitle ?? null,
          extra.ntsValidate ?? null,
        ],
      );
      const user = await client.query(
        `INSERT INTO users (company_id, email, name, password_hash, role) VALUES ($1, $2, $3, $4, 'admin') RETURNING id`,
        [company.rows[0].id, email, name, passwordHash],
      );
      return user.rows[0].id as number;
    }).catch((err) => {
      if (dbErrorCode(err) === "23505") {
        throw new AuthError("그 사이에 같은 이메일이나 사업자등록번호로 가입이 진행됐어요. 로그인하거나 다시 확인해 주세요.", 409);
      }
      throw err;
    });

    if (autoApprove) {
      await startSession(userId, request);
      return NextResponse.json({ user: await userById(userId) });
    }

    // 승인 요청 알림. 실패해도 가입 신청은 이미 저장됐으므로 오류로 돌려주지 않는다.
    const admins = siteAdminEmails();
    if (admins.length) {
      const text = [
        "새 회사 가입 신청이 들어왔어요.",
        "",
        `회사: ${companyName}`,
        `사업자등록번호: ${businessNumber ? formatBusinessNumber(businessNumber) : "(없음)"}`,
        `국세청 조회: ${nts ? `${nts.status}${nts.note ? ` (${nts.note})` : ""}` : "-"}`,
        `진위확인(대표자 ${extra.repName ?? "-"}): ${(extra.ntsValidate as { result?: string } | null)?.result ?? "-"}`,
        `신청자: ${name}${extra.applicantTitle ? ` (${extra.applicantTitle})` : ""} <${email}>`,
        "",
        "승인 전에 회사 대표 전화(홈페이지·114에서 찾은 번호)로 이 사람이 신청한 것이 맞는지 확인해 주세요.",
        "",
        `사이트에 로그인해 '가입 승인'에서 확인해 주세요: ${siteUrl(request)}`,
      ].join("\n");
      await Promise.allSettled(admins.map((to) => sendMail(to, "회사 가입 승인 요청", text)));
    }
    return NextResponse.json({ pending: true });
  } catch (err) {
    return authErrorResponse(err, "register-verify");
  }
}
