"use client";

// 작업 전 점검 체크리스트 (11/24): 평가표의 감소대책을 오늘 작업 전에 하나씩 확인한다.
// 위험성평가는 한 번 만들고 서랍에 넣으면 의미가 없어서, 작업 전 안전 회의(TBM) 때 휴대폰으로 체크하게 했다.
// 체크리스트는 코드가 만든다 (lib/checklist.ts). 로그인한 회사 계정은 결과를 회사 기록에 저장한다.
import { useEffect, useMemo, useState } from "react";
import { buildChecklist } from "@/lib/checklist";
import type { DailyCheck as CheckRecord } from "@/lib/daily-checks";
import type { Assessment, RiskLevel } from "@/lib/schema";
import { AlertIcon, CheckCircleIcon, PrinterIcon } from "./icons";

const LEVEL_CLASS: Record<RiskLevel, string> = { 높음: "high", 보통: "mid", 낮음: "low" };

export function DailyCheck({ assessment, signedIn }: { assessment: Assessment; signedIn: boolean }) {
  const items = useMemo(() => buildChecklist(assessment), [assessment]);
  const [done, setDone] = useState<boolean[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [savedAt, setSavedAt] = useState("");
  const [recent, setRecent] = useState<CheckRecord[]>([]);

  // 평가표가 바뀌면 처음부터 다시 체크
  useEffect(() => {
    setDone(items.map(() => false));
    setNote("");
    setSavedAt("");
    setError("");
  }, [items]);

  useEffect(() => {
    if (!signedIn) return;
    fetch("/api/checks", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => data?.checks && setRecent(data.checks))
      .catch(() => undefined);
  }, [signedIn]);

  const count = done.filter(Boolean).length;
  const today = new Date().toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "short" });

  async function save() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/checks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: assessment.작업명,
          note,
          items: items.map((it, i) => ({ action: it.action, task: it.task, hazard: it.hazard, level: it.level, done: !!done[i] })),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "점검 기록을 저장하지 못했어요.");
      setRecent(data.checks ?? []);
      setSavedAt(new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }));
    } catch (err) {
      setError(err instanceof TypeError ? "서버에 연결하지 못했어요." : err instanceof Error ? err.message : "점검 기록을 저장하지 못했어요.");
    } finally {
      setBusy(false);
    }
  }

  function printCheck() {
    document.body.dataset.print = "check";
    const off = () => {
      delete document.body.dataset.print;
      window.removeEventListener("afterprint", off);
    };
    window.addEventListener("afterprint", off);
    window.print();
  }

  if (items.length === 0) return null;

  return (
    <section className="daily-check" aria-labelledby="check-title">
      <div className="check-head">
        <div>
          <h2 id="check-title">작업 전 점검</h2>
          <p className="hint">
            평가표의 감소대책을 오늘 작업 전에 하나씩 확인해요. 작업 전 안전 회의(TBM) 때 휴대폰으로 체크하고, 위험성이 높은 것부터
            놓았어요.{signedIn ? " 저장하면 회사 기록에 남아요." : ""}
          </p>
        </div>
        <button type="button" className="ghost small check-print" onClick={printCheck}>
          <PrinterIcon size={14} />
          점검표 인쇄하기
        </button>
      </div>

      <div className="check-sheet">
        <div className="check-sheet-head">
          <p className="check-sheet-title">{assessment.작업명}</p>
          <p className="check-date">
            <span>{today}</span>
            <span>점검자 ____________</span>
          </p>
          <p className={`check-count${count === items.length ? " all" : ""}`} aria-live="polite">
            {count === items.length && <CheckCircleIcon size={16} />}
            {count} / {items.length} 확인
          </p>
        </div>
        <ol className="check-list">
          {items.map((it, i) => (
            <li key={i}>
              <label className={done[i] ? "checked" : undefined}>
                <input
                  type="checkbox"
                  checked={!!done[i]}
                  onChange={(e) => setDone(done.map((v, j) => (j === i ? e.target.checked : v)))}
                />
                <span className="check-box" aria-hidden="true" />
                <span className="check-text">
                  <span className="check-action">{it.action}</span>
                  <span className="check-why">
                    <span className={`risk-dot ${LEVEL_CLASS[it.level]}`} aria-hidden="true" />
                    위험성 {it.level} {it.score}점: {it.hazard}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ol>
        <label className="check-note">
          특이사항 (못 한 것과 이유, 새로 발견한 위험)
          <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={2} />
        </label>
      </div>

      <div className="check-actions">
        {signedIn ? (
          <button type="button" className="primary" onClick={save} disabled={busy} aria-busy={busy}>
            {busy ? "저장하는 중…" : "점검 결과 저장"}
          </button>
        ) : (
          <p className="hint">점검 결과 저장은 로그인한 회사 계정만 쓸 수 있어요. 체크와 인쇄는 지금도 할 수 있어요.</p>
        )}
        {savedAt && !error && (
          <p className="ok">
            {savedAt}에 저장했어요 ({count}/{items.length} 확인).
          </p>
        )}
        {error && (
          <p className="error" role="alert">
            <AlertIcon size={16} />
            {error}
          </p>
        )}
      </div>

      {signedIn && recent.length > 0 && (
        <div className="check-recent">
          <h3>최근 점검 기록</h3>
          <ul>
            {recent.slice(0, 5).map((c) => (
              <li key={c.id}>
                <span className="check-recent-date">{c.checkDate}</span>
                <span className="check-recent-title">{c.title}</span>
                <span className={c.doneCount === c.total ? "ok-text" : "warn-text"}>
                  {c.doneCount}/{c.total} 확인
                </span>
                <span className="check-recent-who">{c.author}</span>
                {c.note && <span className="check-recent-note">{c.note}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
