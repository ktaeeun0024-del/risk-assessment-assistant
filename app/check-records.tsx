"use client";

// 작업 전 점검 기록 (11/22): 우리 회사의 지난 점검을 보고(항목별 확인·미확인, 특이사항), 한 달치를 CSV로 내려받는다.
// 위험성평가를 '실제로 해 왔다'는 기록을 보관·제출할 수 있게 하려는 것.
import { useEffect, useState } from "react";
import type { DailyCheck, DailyCheckDetail } from "@/lib/daily-checks";
import { DownloadIcon } from "./icons";

const thisMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

export function CheckRecords({ refreshKey }: { refreshKey: number }) {
  const [checks, setChecks] = useState<DailyCheck[]>([]);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState<DailyCheckDetail | null>(null);
  const [month, setMonth] = useState(thisMonth);

  useEffect(() => {
    fetch("/api/checks", { cache: "no-store" })
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (!res.ok || !data) throw new Error(data?.error ?? "점검 기록을 불러오지 못했어요.");
        setChecks(data.checks);
        setError("");
      })
      .catch((err) => setError(err instanceof Error && !(err instanceof TypeError) ? err.message : "점검 기록을 불러오지 못했어요."));
  }, [refreshKey]);

  async function show(id: number) {
    if (detail?.id === id) {
      setDetail(null);
      return;
    }
    const res = await fetch(`/api/checks?id=${id}`, { cache: "no-store" }).catch(() => null);
    const data = res ? await res.json().catch(() => null) : null;
    if (res?.ok && data?.check) setDetail(data.check);
    else setError(data?.error ?? "점검 기록을 불러오지 못했어요.");
  }

  return (
    <section className="history check-records">
      <h2>작업 전 점검 기록</h2>
      <p className="hint">언제, 누가, 어떤 대책을 확인했고 무엇을 못 했는지 날짜별로 남아요. 한 달치를 엑셀(CSV)로 내려받아 보관할 수 있어요.</p>

      <div className="records-tools">
        <label>
          내려받을 달
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} max={thisMonth()} />
        </label>
        <a className="button ghost small" href={`/api/checks?format=csv&month=${month}`} download>
          <DownloadIcon size={14} />
          {month.replace("-", "년 ")}월 CSV 내려받기
        </a>
      </div>

      {error && <p className="error">{error}</p>}
      {checks.length === 0 && !error ? (
        <p className="placeholder">아직 저장한 점검이 없어요. 위의 오늘의 작업 전 점검이나 평가표 아래의 점검표에서 저장하면 여기에 쌓여요.</p>
      ) : (
        <ol className="records">
          {checks.map((c) => (
            <li key={c.id}>
              <div className="history-row">
                <div>
                  <p className="history-input">{c.title}</p>
                  <ul className="meta history-meta">
                    <li>{c.checkDate}</li>
                    <li>{c.author}</li>
                    <li className={c.doneCount === c.total ? "pass" : "fail"}>
                      {c.doneCount}/{c.total} 확인
                    </li>
                  </ul>
                  {c.note && <p className="history-desc">특이사항: {c.note}</p>}
                </div>
                <button type="button" className="ghost small" aria-expanded={detail?.id === c.id} onClick={() => show(c.id)}>
                  {detail?.id === c.id ? "접기" : "자세히"}
                </button>
              </div>
              {detail?.id === c.id && (
                <ul className="record-items">
                  {detail.items.map((it, i) => (
                    <li key={i} className={it.done ? "done" : "missed"}>
                      <span className="record-mark">{it.done ? "확인" : "못 함"}</span>
                      <span>
                        {it.action}
                        <span className="record-why">
                          위험성 {it.level}: {it.hazard}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
