"use client";

import { useEffect, useState } from "react";
import {
  DEFAULT_MODE,
  EXAMPLE,
  MAX_LENGTH,
  MIN_LENGTH,
  MODES,
  type AssessResponse,
  type Mode,
} from "@/lib/options";
import { riskLevel, type Assessment, type RiskLevel, type ValidationReport } from "@/lib/schema";
import type { HistoryItem } from "@/lib/history";
import { AuthPanel, MembersPanel, PasswordPanel, postJson, ROLE_NAMES, type Me } from "./account";

const LEVEL_CLASS: Record<RiskLevel, string> = { 높음: "high", 보통: "mid", 낮음: "low" };

type Panel = "login" | "register" | "password" | "members" | null;

export default function Home() {
  const [me, setMe] = useState<Me | null>(null);
  const [dbAvailable, setDbAvailable] = useState(true);
  const [panel, setPanel] = useState<Panel>(null);
  const [description, setDescription] = useState("");
  const [mode, setMode] = useState<Mode>(DEFAULT_MODE);
  const [result, setResult] = useState<AssessResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyError, setHistoryError] = useState("");

  // 로그인하지 않았거나 임시 비밀번호 상태면 AI 초안은 쓸 수 없다
  const canUseAi = !!me && !me.mustChangePassword;
  const effectiveMode: Mode = canUseAi ? mode : "search";

  async function loadHistory() {
    try {
      const res = await fetch("/api/history", { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) throw new Error(data?.error ?? "기록을 불러오지 못했어요.");
      setHistory(data.items);
      setHistoryError("");
    } catch (err) {
      setHistoryError(
        err instanceof Error && !(err instanceof TypeError) ? err.message : "기록을 불러오지 못했어요.",
      );
    }
  }

  function signedIn(user: Me) {
    setMe(user);
    setPanel(user.mustChangePassword ? "password" : null);
    if (!user.mustChangePassword) loadHistory();
  }

  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        setDbAvailable(data?.dbAvailable !== false);
        if (data?.user) signedIn(data.user);
      })
      .catch(() => setDbAvailable(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function logout() {
    await postJson("/api/auth/logout").catch(() => undefined);
    setMe(null);
    setPanel(null);
    setHistory([]);
    setResult(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const res = await fetch("/api/assess", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description, mode: effectiveMode }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) {
        throw new Error(data?.error ?? "서버와 연결이 원활하지 않아요. 잠시 후 다시 시도해 주세요.");
      }
      setResult(data);
      if (me) loadHistory();
    } catch (err) {
      setError(
        err instanceof TypeError
          ? "서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요."
          : err instanceof Error
            ? err.message
            : "평가표를 만들지 못했어요.",
      );
    } finally {
      setLoading(false);
    }
  }

  function showHistory(item: HistoryItem) {
    setDescription(item.description);
    setResult({
      assessment: item.assessment,
      report: item.report,
      mode: item.mode,
      model: item.model,
      attempts: 0,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const length = description.trim().length;

  return (
    <main className="container">
      <header className="topbar">
        <div>
          <h1>위험성평가 도우미</h1>
          <p className="subtitle">
            작업 내용을 말로 설명하면 위험성평가표 초안을 만들어 드려요. 만든 초안은 코드가 한 번 더 검사해요.
          </p>
        </div>
        <nav className="account">
          {me ? (
            <>
              <span className="who">
                {me.companyName} · {me.name} <span className="tag">{ROLE_NAMES[me.role]}</span>
              </span>
              <button type="button" className="ghost small" onClick={() => setPanel(panel === "password" ? null : "password")}>
                비밀번호 변경
              </button>
              {me.role === "admin" && !me.mustChangePassword && (
                <button type="button" className="ghost small" onClick={() => setPanel(panel === "members" ? null : "members")}>
                  직원 관리
                </button>
              )}
              <button type="button" className="ghost small" onClick={logout}>
                로그아웃
              </button>
            </>
          ) : dbAvailable ? (
            <>
              <button type="button" className="ghost small" onClick={() => setPanel(panel === "login" ? null : "login")}>
                로그인
              </button>
              <button type="button" className="ghost small" onClick={() => setPanel(panel === "register" ? null : "register")}>
                회사 등록
              </button>
            </>
          ) : (
            <span className="hint">지금은 로그인 기능을 쓸 수 없어요 (DB 연결 안 됨)</span>
          )}
        </nav>
      </header>

      {!me && (panel === "login" || panel === "register") && <AuthPanel initial={panel} onDone={signedIn} />}
      {me && panel === "password" && (
        <PasswordPanel forced={me.mustChangePassword} onDone={(user) => signedIn(user)} />
      )}
      {me && panel === "members" && me.role === "admin" && <MembersPanel me={me} />}

      <form className="form" onSubmit={handleSubmit}>
        <div className="options">
          <fieldset className="option-group">
            <legend>만드는 방식</legend>
            {(Object.keys(MODES) as Mode[]).map((key) => {
              const locked = key === "ai" && !canUseAi;
              return (
                <label
                  key={key}
                  className={[key === effectiveMode ? "selected" : "", locked ? "locked" : ""].join(" ").trim() || undefined}
                  title={locked ? "로그인한 회사 계정만 쓸 수 있어요" : undefined}
                >
                  <input
                    type="radio"
                    name="mode"
                    value={key}
                    checked={key === effectiveMode}
                    disabled={locked}
                    onChange={() => setMode(key)}
                  />
                  {MODES[key]}
                  {locked && " 🔒"}
                </label>
              );
            })}
          </fieldset>
          <button type="button" className="ghost" onClick={() => setDescription(EXAMPLE)}>
            예시 넣기
          </button>
        </div>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="예: 지게차로 철판 코일을 옮기고, 80톤 프레스로 브래킷을 찍습니다. 방호장치는 1대에만 있고, 소음이 커서 귀마개를 나눠주지만 잘 안 씁니다."
          maxLength={MAX_LENGTH}
          rows={6}
          aria-label="작업 설명"
        />
        <div className="form-footer">
          <span className="counter">
            {length} / {MAX_LENGTH}자 · 무엇을, 어떤 기계·물질로, 몇 명이, 지금 어떤 안전조치를 하는지 적어 주세요
          </span>
          <button type="submit" disabled={loading || length < MIN_LENGTH}>
            {loading ? "만드는 중…" : "평가표 만들기"}
          </button>
        </div>
      </form>

      {!canUseAi && (
        <p className="hint">
          {me
            ? "임시 비밀번호를 바꾸면 AI 초안을 쓸 수 있어요."
            : "로그인하지 않아도 표준모델 검색 초안은 만들 수 있어요. AI 초안과 회사 기록 저장은 로그인한 회사 계정만 쓸 수 있어요."}
        </p>
      )}
      {loading && effectiveMode === "ai" && (
        <p className="placeholder">무료 AI 모델이라 30초~1분쯤 걸릴 수 있어요.</p>
      )}
      {error && <p className="error">{error}</p>}

      {result && <ResultView result={result} />}

      {me && !me.mustChangePassword && (
      <section className="history">
        <h2>우리 회사 평가표 · {me.companyName}</h2>
        <p className="hint">같은 회사 계정끼리만 보여요. 위험성평가 결과는 기록해 두고 보존해야 하니 CSV로도 내려받아 두세요.</p>
        {historyError ? (
          <p className="placeholder">{historyError}</p>
        ) : history.length === 0 ? (
          <p className="placeholder">아직 만든 평가표가 없어요.</p>
        ) : (
          <ol>
            {history.map((item) => (
              <li key={item.id}>
                <div className="history-row">
                  <div>
                    <p className="history-input">{item.title}</p>
                    <p className="history-meta">
                      {item.author} · {MODES[item.mode] ?? item.mode} · {item.itemCount}개 항목 · 검사{" "}
                      {item.passed ? "통과" : "불통과"} · {new Date(item.createdAt).toLocaleString("ko-KR")}
                    </p>
                  </div>
                  <button type="button" className="ghost" onClick={() => showHistory(item)}>
                    다시 보기
                  </button>
                </div>
                <p className="history-desc">{item.description}</p>
              </li>
            ))}
          </ol>
        )}
      </section>
      )}
    </main>
  );
}

function ResultView({ result }: { result: AssessResponse }) {
  const { assessment, report } = result;
  const counts = { 높음: 0, 보통: 0, 낮음: 0 } as Record<RiskLevel, number>;
  for (const it of assessment.항목) counts[riskLevel(it.가능성, it.중대성)]++;

  return (
    <section className="result">
      <div className="result-header">
        <div>
          <h2>{assessment.작업명}</h2>
          <p className="model">
            {MODES[result.mode]} · {result.model} · {assessment.항목.length}개 항목
            {result.attempts > 1 && ` · AI 호출 ${result.attempts}회`}
          </p>
        </div>
        <button type="button" className="ghost" onClick={() => downloadCsv(assessment)}>
          CSV 내려받기
        </button>
      </div>

      {result.notice && <p className="notice">{result.notice}</p>}
      {result.saved && <p className="ok">우리 회사 기록에 저장했어요.</p>}

      <p className="disclaimer">
        초안입니다. 해당 작업을 하는 근로자와 함께 확인하고 현장에 맞게 고치세요. 위험성평가의 최종 판단과
        책임은 사업주에게 있습니다.
        {result.mode === "search" && " 표준모델 검색 초안의 가능성·중대성은 규칙으로 정한 기본값입니다."}
      </p>

      <CheckView report={report} />

      <div className="levels">
        {(Object.keys(counts) as RiskLevel[]).map((lv) => (
          <span key={lv} className={`badge ${LEVEL_CLASS[lv]}`}>
            위험성 {lv} {counts[lv]}
          </span>
        ))}
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>세부작업</th>
              <th>분류</th>
              <th>유해·위험요인</th>
              <th>현재 위험성</th>
              <th>감소대책</th>
              <th>개선 후</th>
              <th>관련근거</th>
            </tr>
          </thead>
          <tbody>
            {assessment.항목.map((it, i) => {
              const before = riskLevel(it.가능성, it.중대성);
              const after = riskLevel(it.개선후가능성, it.개선후중대성);
              const src = result.sources?.[i];
              return (
                <tr key={i}>
                  <td>{i + 1}</td>
                  <td>{it.세부작업}</td>
                  <td className="nowrap">{it.분류}</td>
                  <td>
                    {it.유해위험요인}
                    {it.원인 && <span className="sub">원인: {it.원인}</span>}
                    {src && <span className="sub">표준모델: {src.표준모델_작업}</span>}
                  </td>
                  <td>
                    <span className={`badge ${LEVEL_CLASS[before]}`}>
                      {before} {it.가능성}×{it.중대성}
                    </span>
                  </td>
                  <td>
                    {it.감소대책.length ? (
                      <ul>
                        {it.감소대책.map((m, j) => (
                          <li key={j}>{m}</li>
                        ))}
                      </ul>
                    ) : (
                      <span className="sub">-</span>
                    )}
                  </td>
                  <td>
                    <span className={`badge ${LEVEL_CLASS[after]}`}>
                      {after} {it.개선후가능성}×{it.개선후중대성}
                    </span>
                  </td>
                  <td className="law">{it.관련근거 || "-"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function CheckView({ report }: { report: ValidationReport }) {
  return (
    <div className={`check ${report.ok ? "pass" : "fail"}`}>
      <p className="check-title">
        코드 검사: {report.ok ? "통과" : `오류 ${report.errors.length}개`}
        {report.warnings.length > 0 && ` · 확인 필요 ${report.warnings.length}개`}
      </p>
      {report.errors.length > 0 && (
        <ul className="errors">
          {report.errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}
      {report.warnings.length > 0 && (
        <ul className="warnings">
          {report.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

// 엑셀에서 한글이 깨지지 않도록 BOM을 붙인 CSV로 내려받는다.
function downloadCsv(a: Assessment) {
  const header = ["번호", "세부작업", "분류", "원인", "유해위험요인", "관련근거", "현재조치", "가능성", "중대성",
    "위험성", "감소대책", "개선후가능성", "개선후중대성", "개선후위험성"];
  const rows = a.항목.map((it, i) => [
    i + 1, it.세부작업, it.분류, it.원인, it.유해위험요인, it.관련근거, it.현재조치, it.가능성, it.중대성,
    riskLevel(it.가능성, it.중대성), it.감소대책.join("\n"), it.개선후가능성, it.개선후중대성,
    riskLevel(it.개선후가능성, it.개선후중대성),
  ]);
  const esc = (v: unknown) => `"${String(v ?? "").replaceAll('"', '""')}"`;
  const csv = [header, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `위험성평가_${a.작업명.replace(/[\\/:*?"<>|]/g, "_")}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
