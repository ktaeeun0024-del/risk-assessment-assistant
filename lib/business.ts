// 사업자등록번호: 형식(검증 숫자) 확인과 국세청 사업자등록 상태 조회. 서버에서만 쓴다.
//
// 국세청 조회는 공공데이터포털 '국세청_사업자등록정보 진위확인 및 상태조회 서비스'를 쓴다.
// 환경변수 NTS_SERVICE_KEY(일반 인증키, Decoding)가 없거나 조회에 실패해도 가입은 막지 않고,
// '확인 못 함'으로 저장해 사이트 관리자가 승인 화면에서 직접 판단하게 한다.
import { AuthError } from "./auth";

const WEIGHTS = [1, 3, 7, 1, 3, 7, 1, 3, 5];

// '123-45-67890' → '1234567890'. 형식이 틀리면 AuthError.
export function normalizeBusinessNumber(v: unknown): string {
  const digits = typeof v === "string" ? v.replace(/[\s-]/g, "") : "";
  if (!/^\d{10}$/.test(digits) || !validChecksum(digits)) {
    throw new AuthError("사업자등록번호 10자리를 다시 확인해 주세요.", 400);
  }
  return digits;
}

// 국세청 검증 공식: 앞 9자리에 가중치를 곱해 더하고, 9번째 자리×5의 십의 자리를 더한 뒤 마지막 자리와 비교
export function validChecksum(d: string): boolean {
  const n = d.split("").map(Number);
  let sum = WEIGHTS.reduce((acc, w, i) => acc + n[i] * w, 0);
  sum += Math.floor((n[8] * 5) / 10);
  return (10 - (sum % 10)) % 10 === n[9];
}

export const formatBusinessNumber = (d: string) => `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;

export type NtsCheck = {
  checkedAt: string;
  ok: boolean; // 조회 자체가 성공했는지
  status: string; // 계속사업자 / 휴업자 / 폐업자 / 미등록 / 확인 못 함
  taxType?: string;
  closedAt?: string;
  note?: string;
};

export async function checkWithNts(businessNumber: string): Promise<NtsCheck> {
  const checkedAt = new Date().toISOString();
  const key = process.env.NTS_SERVICE_KEY;
  if (!key) return { checkedAt, ok: false, status: "확인 못 함", note: "국세청 조회 키(NTS_SERVICE_KEY)가 없음" };
  try {
    const res = await fetch(
      `https://api.odcloud.kr/api/nts-businessman/v1/status?serviceKey=${encodeURIComponent(key)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ b_no: [businessNumber] }),
        signal: AbortSignal.timeout(4_000),
      },
    );
    if (!res.ok) return { checkedAt, ok: false, status: "확인 못 함", note: `국세청 조회 실패 (HTTP ${res.status})` };
    const data = (await res.json()) as {
      data?: { b_stt?: string; tax_type?: string; end_dt?: string }[];
    };
    const row = data.data?.[0];
    if (!row) return { checkedAt, ok: false, status: "확인 못 함", note: "국세청 응답에 결과가 없음" };
    if (!row.b_stt) {
      return { checkedAt, ok: true, status: "미등록", note: row.tax_type || "국세청에 등록되지 않은 번호" };
    }
    return {
      checkedAt,
      ok: true,
      status: row.b_stt,
      taxType: row.tax_type || undefined,
      closedAt: row.end_dt || undefined,
    };
  } catch {
    return { checkedAt, ok: false, status: "확인 못 함", note: "국세청 조회 시간 초과 또는 연결 실패" };
  }
}
