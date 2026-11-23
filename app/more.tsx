"use client";

// 휴대폰에서 긴 목록 접기 (11/23): 내용이 많으면 아래로 너무 많이 내려야 해서, 폭 600px 미만에서는
// 처음 몇 개만 보여 주고 '더보기'로 펼친다. 컴퓨터 화면과 인쇄에서는 언제나 전부 보인다 (globals.css의 .more).
// 감쌀 목록(ol·ul·tbody)에 className "more-items"를 붙이면, 그 바로 아래 자식 중 limit개 다음부터 숨긴다.
import { useState, type ReactNode } from "react";

export function More({
  total,
  limit,
  unit = "개",
  children,
}: {
  total: number;
  limit: 1 | 2 | 3 | 5;
  unit?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const hidden = total - limit;
  return (
    <div className="more" data-limit={limit} data-open={open || hidden <= 0}>
      {children}
      {hidden > 0 && (
        <button type="button" className="ghost small more-btn" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? "접기" : `더보기 (${hidden}${unit} 더)`}
        </button>
      )}
    </div>
  );
}
