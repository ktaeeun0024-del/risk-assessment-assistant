// 메일 보내기 (Gmail SMTP). 서버에서만 쓴다.
//
// 환경변수: SMTP_USER(보내는 Gmail 주소), SMTP_PASS(Gmail '앱 비밀번호' 16자리)
// 개발 중(NODE_ENV가 production이 아님)에 SMTP 설정이 없으면 메일 대신 서버 터미널에 내용을 찍는다.
// 배포 환경에서는 인증번호를 로그에 남기지 않는다.
import nodemailer, { type Transporter } from "nodemailer";
import { AuthError } from "./auth";

const SITE_NAME = "반장노트";

let transporter: Transporter | null = null;

function smtpConfigured(): boolean {
  return !!process.env.SMTP_USER && !!process.env.SMTP_PASS;
}

function getTransporter(): Transporter {
  transporter ??= nodemailer.createTransport({
    host: process.env.SMTP_HOST ?? "smtp.gmail.com",
    port: Number(process.env.SMTP_PORT ?? 465),
    secure: true,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    connectionTimeout: 5_000,
    greetingTimeout: 5_000,
    socketTimeout: 7_000,
  });
  return transporter;
}

export async function sendMail(to: string, subject: string, text: string): Promise<void> {
  if (!smtpConfigured()) {
    if (process.env.NODE_ENV !== "production") {
      console.log(`[dev-mail] to=${to} subject=${subject}\n${text}\n[/dev-mail]`);
      return;
    }
    console.error("[mail] SMTP_USER/SMTP_PASS가 설정되지 않음");
    throw new AuthError("지금은 메일을 보낼 수 없어요. 사이트 관리자에게 알려 주세요.", 503);
  }
  try {
    await getTransporter().sendMail({
      from: `"${SITE_NAME}" <${process.env.SMTP_USER}>`,
      to,
      subject: `[${SITE_NAME}] ${subject}`,
      text,
    });
  } catch (err) {
    // 오류 내용에 계정 정보가 섞일 수 있어 코드만 남긴다
    const code = typeof err === "object" && err && "code" in err ? String((err as { code: unknown }).code) : "unknown";
    console.error(`[mail] 발송 실패: ${code}`);
    throw new AuthError("메일을 보내지 못했어요. 이메일 주소를 확인하고 잠시 후 다시 시도해 주세요.", 502);
  }
}

// 사이트 주소 (메일 본문의 링크용). Netlify는 URL 환경변수를 자동으로 넣어 준다.
export function siteUrl(request?: Request): string {
  const env = process.env.SITE_URL ?? process.env.URL;
  if (env) return env.replace(/\/$/, "");
  return request ? new URL(request.url).origin : "";
}

export function codeMailText(intro: string, code: string, minutes: number, link: string): string {
  return [
    intro,
    "",
    `인증번호: ${code}`,
    "",
    `${minutes >= 60 ? `${minutes / 60}시간` : `${minutes}분`} 안에 사이트에 입력해 주세요.`,
    link ? `사이트: ${link}` : "",
    "",
    "본인이 요청하지 않았다면 이 메일을 무시하세요. 인증번호를 다른 사람에게 알려 주지 마세요.",
  ]
    .filter((line, i, arr) => !(line === "" && arr[i - 1] === ""))
    .join("\n");
}
