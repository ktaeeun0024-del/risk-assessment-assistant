"use client";

// 오늘의 작업 전 점검 (11/22): 로그인하면 첫 화면 맨 위에 보인다.
// 회사가 '매일 점검에 쓰기'로 고른 평가표마다 오늘 점검했는지 보여 주고, 누르면 그 평가표의 체크리스트가 열린다.
// 매일 초안을 새로 만들지 않고, 이미 만들어 둔 평가표로 매일 점검하게 하려는 것.
import { useEffect, useState } from "react";
import type { TodayItem } from "@/lib/daily-checks";
import { DailyCheck } from "./daily-check";
import { CheckCircleIcon } from "./icons";

const time = (iso: string) => new Date(iso).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });

export function TodayChecks({ refreshKey, onChanged }: { refreshKey: number; onChanged: () => void }) {
  const [items, setItems] = useState<TodayItem[] | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<number | null>(null);

  function load() {
    fetch("/api/checks?view=today", { cache: "no-store" })
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (!res.ok || !data) throw new Error(data?.error ?? "오늘의 점검을 불러오지 못했어요.");
        setItems(data.today);
        setError("");
      })
      .catch((err) => setError(err instanceof Error && !(err instanceof TypeError) ? err.message : "오늘의 점검을 불러오지 못했어요."));
  }
  useEffect(load, [refreshKey]);

  const today = new Date().toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" });
  const opened = items?.find((it) => it.historyId === open) ?? null;
  const doneToday = items?.filter((it) => it.today).length ?? 0;

  return (
    <section className="today" aria-labelledby="today-title">
      <div className="today-head">
        <h2 id="today-title">오늘의 작업 전 점검</h2>
        <p className="today-date">{today}</p>
        {items && items.length > 0 && (
          <p className={`today-progress${doneToday === items.length ? " all" : ""}`}>
            {doneToday} / {items.length} 작업 점검함
          </p>
        )}
      </div>

      {error && <p className="error">{error}</p>}
      {items && items.length === 0 && (
        <p className="today-empty">
          매일 점검할 평가표가 아직 없어요. 아래 <b>우리 회사 평가표</b>에서 매일 하는 작업의 평가표에 <b>매일 점검에 쓰기</b>를
          눌러 주세요. 평가표가 없으면 먼저 작업을 설명해 평가표를 만들어요.
        </p>
      )}

      {items && items.length > 0 && (
        <ul className="today-list">
          {items.map((it) => (
            <li key={it.historyId} className={open === it.historyId ? "open" : undefined}>
              <div className="today-title">
                <b>{it.title}</b>
                {it.today ? (
                  <span className="today-done">
                    <CheckCircleIcon size={16} />
                    오늘 {it.today.doneCount}/{it.today.total} 확인, {it.today.author} {time(it.today.createdAt)}
                  </span>
                ) : (
                  <span className="today-todo">오늘 아직 점검 안 함</span>
                )}
              </div>
              <button
                type="button"
                className={it.today ? "ghost" : "primary"}
                aria-expanded={open === it.historyId}
                onClick={() => setOpen(open === it.historyId ? null : it.historyId)}
              >
                {open === it.historyId ? "닫기" : it.today ? "다시 점검" : "점검하기"}
              </button>
            </li>
          ))}
        </ul>
      )}

      {opened && (
        <DailyCheck
          key={opened.historyId}
          assessment={opened.assessment}
          signedIn
          historyId={opened.historyId}
          heading={`${opened.title} 점검`}
          onSaved={() => {
            load();
            onChanged();
          }}
        />
      )}
    </section>
  );
}
