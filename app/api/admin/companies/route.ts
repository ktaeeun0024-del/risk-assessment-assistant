// 사이트 관리자 전용: 회사 가입 신청 목록과 승인 · 거절 · 국세청 다시 조회
// (11/18) 같은 사업자등록번호의 승인 대기가 여러 개일 수 있다. 승인된 회사는 번호 하나에 하나만 (DB 고유 인덱스).
import { NextResponse } from "next/server";
import { AuthError, authErrorResponse, checkSameOrigin, readJson, requireSiteAdmin } from "@/lib/auth";
import { checkWithNts, formatBusinessNumber, validateWithNts, type NtsCheck, type NtsValidate } from "@/lib/business";
import { db, dbErrorCode } from "@/lib/db";
import { sendMail, siteUrl } from "@/lib/mail";

type CompanyRow = {
  id: number;
  name: string;
  businessNumber: string | null;
  status: "pending" | "approved" | "rejected";
  ntsCheck: NtsCheck | null;
  createdAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  adminName: string | null;
  adminEmail: string | null;
  repName: string | null;
  startDate: string | null;
  applicantTitle: string | null;
  ntsValidate: NtsValidate | null;
  sameNumber: number; // 같은 번호의 다른 신청(대기·승인) 수
};

// 승인 대기 전부 + 최근에 처리한 20곳
async function listCompanies() {
  const { rows } = await (await db()).query(
    `SELECT c.id, c.name, c.business_number AS "businessNumber", c.status, c.nts_check AS "ntsCheck",
            c.created_at AS "createdAt", c.reviewed_at AS "reviewedAt", c.reviewed_by AS "reviewedBy",
            a.name AS "adminName", a.email AS "adminEmail",
            c.rep_name AS "repName", c.start_date AS "startDate", c.applicant_title AS "applicantTitle",
            c.nts_validate AS "ntsValidate",
            (SELECT count(*)::int FROM companies o
              WHERE o.business_number = c.business_number AND o.id <> c.id AND o.status <> 'rejected') AS "sameNumber"
       FROM companies c
       LEFT JOIN LATERAL (SELECT name, email FROM users WHERE company_id = c.id AND role = 'admin'
                           ORDER BY created_at LIMIT 1) a ON true
      WHERE c.status = 'pending' OR c.id IN (
              SELECT id FROM companies WHERE status <> 'pending' ORDER BY coalesce(reviewed_at, created_at) DESC LIMIT 20)
      ORDER BY (c.status = 'pending') DESC, c.created_at DESC`,
  );
  return {
    companies: (rows as CompanyRow[]).map((r) => ({
      ...r,
      businessNumber: r.businessNumber ? formatBusinessNumber(r.businessNumber) : null,
      createdAt: new Date(r.createdAt).toISOString(),
      reviewedAt: r.reviewedAt ? new Date(r.reviewedAt).toISOString() : null,
    })),
  };
}

export async function GET() {
  try {
    await requireSiteAdmin();
    return NextResponse.json(await listCompanies());
  } catch (err) {
    return authErrorResponse(err, "admin-companies");
  }
}

export async function POST(request: Request) {
  try {
    checkSameOrigin(request);
    const siteAdmin = await requireSiteAdmin();
    const body = await readJson(request);
    const id = Number(body.companyId);
    if (!Number.isInteger(id)) throw new AuthError("회사를 다시 골라 주세요.", 400);
    const pool = await db();

    if (body.action === "recheck") {
      const { rows } = await pool.query(`SELECT business_number, rep_name, start_date FROM companies WHERE id = $1`, [id]);
      const c = rows[0];
      if (!c?.business_number) throw new AuthError("사업자등록번호가 없는 회사예요.", 400);
      const validate = c.rep_name && c.start_date ? await validateWithNts(c.business_number, c.start_date, c.rep_name) : null;
      await pool.query(`UPDATE companies SET nts_check = $2, nts_validate = coalesce($3, nts_validate) WHERE id = $1`, [
        id,
        await checkWithNts(c.business_number),
        validate,
      ]);
      return NextResponse.json(await listCompanies());
    }

    if (body.action !== "approve" && body.action !== "reject") throw new AuthError("잘못된 요청입니다.", 400);
    const approve = body.action === "approve";
    const { rows } = await pool
      .query(
        `UPDATE companies SET status = $2, reviewed_at = now(), reviewed_by = $3
          WHERE id = $1 AND status = 'pending' RETURNING name`,
        [id, approve ? "approved" : "rejected", siteAdmin.email],
      )
      .catch((err) => {
        if (dbErrorCode(err) === "23505") {
          throw new AuthError("같은 사업자등록번호로 이미 승인된 회사가 있어요. 그 회사를 먼저 확인해 주세요.", 409);
        }
        throw err;
      });
    if (!rows[0]) throw new AuthError("이미 처리됐거나 없는 신청이에요.", 409);

    // 결과 알림. 메일이 실패해도 승인·거절은 이미 저장됐다.
    const admins = await pool.query(`SELECT name, email FROM users WHERE company_id = $1 AND role = 'admin'`, [id]);
    const text = approve
      ? `'${rows[0].name}' 회사 가입이 승인됐어요. 이제 로그인해서 쓸 수 있어요.\n\n${siteUrl(request)}`
      : `'${rows[0].name}' 회사 가입이 승인되지 않았어요. 사업자등록번호 등을 확인한 뒤 다시 신청하거나 사이트 관리자에게 문의해 주세요.`;
    await Promise.allSettled(
      admins.rows.map((a) => sendMail(a.email, approve ? "회사 가입 승인 완료" : "회사 가입 승인 결과", `${a.name}님,\n\n${text}`)),
    );
    return NextResponse.json(await listCompanies());
  } catch (err) {
    return authErrorResponse(err, "admin-companies");
  }
}
