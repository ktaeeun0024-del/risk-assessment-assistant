"use client";

import { useEffect, useState } from "react";
import {
  DEFAULT_MODE,
  EXAMPLE,
  MAX_LENGTH,
  MIN_LENGTH,
  MODES,
  isPending,
  type AssessResponse,
  type Mode,
} from "@/lib/options";
import { riskLevel, type Assessment, type RiskLevel, type ValidationReport } from "@/lib/schema";
import type { HistoryItem } from "@/lib/history";
import { AuthPanel, MembersPanel, PasswordPanel, postJson, ROLE_NAMES, SiteAdminPanel, type Me } from "./account";
import { AlertIcon, CheckCircleIcon, DownloadIcon, InfoIcon, LockIcon, PrinterIcon, SearchIcon, SparkIcon } from "./icons";
import { cellOf, MatrixGrid, MatrixGuide, MatrixLegend, ResultGuide, summarize, type Cell } from "./matrix";
import { CheckRecords } from "./check-records";
import { DailyCheck } from "./daily-check";
import { TodayChecks } from "./today-checks";
import { SafetySummary } from "./safety-summary";
import { SifCases } from "./sif-cases";

const LEVEL_CLASS: Record<RiskLevel, string> = { 높음: "high", 보통: "mid", 낮음: "low" };

type Panel = "login" | "register" | "password" | "members" | "siteadmin" | null;

export default function Home() {
  const [me, setMe] = useState<Me | null>(null);
  const [dbAvailable, setDbAvailable] = useState(true);
  const [panel, setPanel] = useState<Panel>(null);
  const [description, setDescription] = useState("");
  const [mode, setMode] = useState<Mode>(DEFAULT_MODE);
  const [result, setResult] = useState<AssessResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [waitSec, setWaitSec] = useState(0);
  const [error, setError] = useState("");
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyError, setHistoryError] = useState("");
  // 위험성 매트릭스에서 고른 칸 (지금/대책 후 중 어느 쪽의 어느 칸인지). 평가표를 그 칸 항목만 거른다.
  const [cell, setCell] = useState<Cell>(null);
  // 평가표가 나오면 입력칸은 접어 두고, '작업 설명 고치기'를 누를 때만 펼친다
  const [editing, setEditing] = useState(false);
  // 지금 보고 있는 평가표가 회사 기록의 몇 번인지 (점검 기록을 그 평가표와 잇는다). 새로 만든 초안은 null
  const [resultHistoryId, setResultHistoryId] = useState<number | null>(null);
  // 점검을 저장하거나 매일 점검 평가표를 바꾸면 오늘의 점검·점검 기록을 다시 불러온다
  const [checksKey, setChecksKey] = useState(0);
  const refreshChecks = () => setChecksKey((k) => k + 1);

  function showResult(next: AssessResponse | null, historyId: number | null = null) {
    setResult(next);
    setResultHistoryId(historyId);
    setCell(null);
    setEditing(false);
  }

  function selectCell(c: Cell) {
    setCell(c);
    if (c) document.getElementById("doc-title")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

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
    showResult(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setWaitSec(0);
    setError("");
    showResult(null);
    try {
      const res = await fetch("/api/assess", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description, mode: effectiveMode }),
      });
      let data = await res.json().catch(() => null);
      if (!res.ok || !data) {
        throw new Error(data?.error ?? "서버와 연결이 원활하지 않아요. 잠시 후 다시 시도해 주세요.");
      }
      // 배포 사이트: AI가 뒤에서 작성 중이면 3초마다 결과를 확인한다 (최대 약 3분)
      const started = Date.now();
      while (isPending(data) && Date.now() - started < 200_000) {
        await new Promise((r) => setTimeout(r, 3_000));
        setWaitSec(Math.round((Date.now() - started) / 1000));
        const poll = await fetch(`/api/assess?job=${data.jobId}`);
        const next = await poll.json().catch(() => null);
        if (!next || (!poll.ok && poll.status !== 202)) {
          throw new Error(next?.error ?? "결과를 확인하지 못했어요. 잠시 후 '최근 기록'에서 확인해 주세요.");
        }
        data = next;
      }
      if (isPending(data)) throw new Error("AI가 아직 작성 중이에요. 잠시 후 '최근 기록'에서 확인해 주세요.");
      showResult(data);
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
    showResult(
      {
        assessment: item.assessment,
        report: item.report,
        mode: item.mode,
        model: item.model,
        attempts: 0,
      },
      item.id,
    );
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // 매일 점검에 쓰기/해제
  async function toggleDaily(item: HistoryItem) {
    try {
      const data = await postJson<{ items: HistoryItem[] }>("/api/history", { id: item.id, daily: !item.daily });
      setHistory(data.items);
      refreshChecks();
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : "매일 점검 설정을 바꾸지 못했어요.");
    }
  }

  const length = description.trim().length;

  const form = (
    <form className="form card" onSubmit={handleSubmit}>
      <div className="form-head">
        <label htmlFor="description" className="form-title">
          {result ? "작업 설명 고치기" : "작업 설명"}
        </label>
        <button type="button" className="ghost small" onClick={() => setDescription(EXAMPLE)}>
          예시 넣기
        </button>
      </div>
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
                {key === "ai" ? <SparkIcon size={15} /> : <SearchIcon size={15} />}
                {MODES[key]}
                {locked && <LockIcon size={14} className="lock" />}
              </label>
            );
          })}
        </fieldset>
      </div>
      <textarea
        id="description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="예: 지게차로 철판 코일을 옮기고, 80톤 프레스로 브래킷을 찍습니다. 방호장치는 1대에만 있고, 소음이 커서 귀마개를 나눠주지만 잘 안 씁니다."
        maxLength={MAX_LENGTH}
        rows={result ? 3 : 5}
        aria-describedby="description-help"
      />
      <div className="form-footer">
        <span className="counter" id="description-help">
          <strong>
            {length} / {MAX_LENGTH}자
          </strong>{" "}
          무엇을, 어떤 기계·물질로, 몇 명이, 지금 어떤 안전조치를 하는지 적어 주세요
        </span>
        <button type="submit" className="primary" disabled={loading || length < MIN_LENGTH} aria-busy={loading}>
          {loading && <span className="spinner" aria-hidden="true" />}
          {loading ? "만드는 중…" : result ? "다시 만들기" : "평가표 만들기"}
        </button>
      </div>
      {!canUseAi && (
        <p className="hint">
          {me
            ? "임시 비밀번호를 바꾸면 AI 초안을 쓸 수 있어요."
            : "로그인하지 않아도 표준모델 검색 초안은 만들 수 있어요. AI 초안과 회사 기록 저장은 로그인한 회사 계정만 쓸 수 있어요."}
        </p>
      )}
      {loading && effectiveMode === "ai" && (
        <p className="hint" aria-live="polite">
          무료 AI 모델이라 1~2분쯤 걸려요.{waitSec > 0 && ` (${waitSec}초째 작성 중)`}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </form>
  );

  const summary = result ? summarize(result.assessment.항목) : null;

  return (
    <>
      <header className="app-header">
        <div className="app-header-inner">
          <a className="brand" href="/" aria-label="반장노트 처음 화면">
            {/* 로고: 가는 선으로 그린 수첩 (반장이 들고 다니는 작업 노트) */}
            <svg className="brand-mark" viewBox="0 0 28 32" aria-hidden="true" focusable="false">
              <rect x="4.5" y="1.5" width="20" height="29" rx="1" />
              <path d="M9 1.5v29M13 9h8M13 13.5h8M13 18h5" />
              <path d="M1.5 7h5M1.5 13h5M1.5 19h5M1.5 25h5" />
            </svg>
            <span className="brand-text">
              <span className="brand-name">반장노트</span>
              <span className="brand-sub">위험성평가 도우미</span>
            </span>
          </a>
          <nav className="account" aria-label="계정">
            {me ? (
              <>
                <span className="who">
                  {me.companyName}
                  <span className="who-sep" aria-hidden="true" />
                  {me.name} <span className="tag">{ROLE_NAMES[me.role]}</span>
                </span>
                <button type="button" className="ghost small" onClick={() => setPanel(panel === "password" ? null : "password")}>
                  비밀번호 변경
                </button>
                {me.role === "admin" && !me.mustChangePassword && (
                  <button type="button" className="ghost small" onClick={() => setPanel(panel === "members" ? null : "members")}>
                    직원 관리
                  </button>
                )}
                {me.isSiteAdmin && !me.mustChangePassword && (
                  <button type="button" className="ghost small" onClick={() => setPanel(panel === "siteadmin" ? null : "siteadmin")}>
                    가입 승인
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
                  회사 가입
                </button>
              </>
            ) : (
              <span className="hint">지금은 로그인 기능을 쓸 수 없어요 (DB 연결 안 됨)</span>
            )}
          </nav>
        </div>
      </header>

      {panel && (
        <div className="container panels">
          {!me && (panel === "login" || panel === "register") && <AuthPanel initial={panel} onDone={signedIn} />}
          {me && panel === "password" && <PasswordPanel forced={me.mustChangePassword} onDone={(user) => signedIn(user)} />}
          {me && panel === "members" && me.role === "admin" && <MembersPanel me={me} />}
          {me && panel === "siteadmin" && me.isSiteAdmin && <SiteAdminPanel />}
        </div>
      )}

      {me && !me.mustChangePassword && (
        <div className="container today-wrap">
          <TodayChecks refreshKey={checksKey} onChanged={refreshChecks} />
        </div>
      )}

      {/* 위쪽 띠: 처음엔 소개·입력·점수 기준, 평가표가 생기면 대책 전후 매트릭스와 한 줄 요약 */}
      <section className="band" aria-label={result ? "대책 전후 위험성" : "평가표 만들기"}>
        <div className={`band-inner${result ? " has-result" : ""}`}>
          {result && summary ? (
            <>
              <div className="band-matrices">
                <MatrixGrid title="지금" items={result.assessment.항목} phase="before" selected={cell} onSelect={selectCell} />
                <span className="band-arrow" aria-hidden="true">
                  →
                </span>
                <MatrixGrid title="대책을 하면" items={result.assessment.항목} phase="after" selected={cell} onSelect={selectCell} />
              </div>
              <div className="band-summary">
                <h1 className="band-headline">{summary.headline}</h1>
                <p className="band-detail">{summary.detail}</p>
                <ResultGuide />
                {editing ? (
                  form
                ) : (
                  <div className="desc-bar">
                    <p className="desc-text" title={description}>
                      {description}
                    </p>
                    <button type="button" className="ghost small" onClick={() => setEditing(true)}>
                      작업 설명 고치기
                    </button>
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="band-intro">
                <h1 className="band-title">
                  작업을 말로 설명하면
                  <br />
                  위험성평가표 초안이 나와요
                </h1>
                <p className="band-detail">
                  유해·위험요인, 위험성, 감소대책, 관련 법 조항까지 고용노동부 지침의 3×3 빈도·강도법으로 정리하고, 다 만든
                  초안은 코드가 한 번 더 검사해요.
                </p>
                {form}
              </div>
              <div className="band-key">
                <MatrixGrid title="위험성은 이렇게 매겨요" items={null} phase="before" />
                <MatrixGuide />
                <MatrixLegend />
              </div>
            </>
          )}
        </div>
      </section>

      <main className="container">
        {result && (
          <ResultView
            result={result}
            me={me}
            cell={cell}
            onClear={() => setCell(null)}
            historyId={resultHistoryId}
            onCheckSaved={refreshChecks}
          />
        )}

        {me && !me.mustChangePassword && (
          <section className="history">
            <h2>우리 회사 평가표</h2>
            <p className="hint">같은 회사 계정끼리만 보여요. 위험성평가 결과는 기록해 두고 보존해야 하니 CSV나 인쇄본으로도 남겨 두세요.</p>
            {historyError ? (
              <p className="placeholder">{historyError}</p>
            ) : history.length === 0 ? (
              <p className="placeholder">아직 만든 평가표가 없어요. 위에서 작업을 설명하고 첫 평가표를 만들어 보세요.</p>
            ) : (
              <ol>
                {history.map((item) => (
                  <li key={item.id}>
                    <div className="history-row">
                      <div>
                        <p className="history-input">
                          {item.title}
                          {item.daily && <span className="tag daily-tag">매일 점검</span>}
                        </p>
                        <ul className="meta history-meta">
                          <li>{item.author}</li>
                          <li>{MODES[item.mode] ?? item.mode}</li>
                          <li>{item.itemCount}개 항목</li>
                          <li className={item.passed ? "pass" : "fail"}>검사 {item.passed ? "통과" : "불통과"}</li>
                          <li>{new Date(item.createdAt).toLocaleString("ko-KR")}</li>
                        </ul>
                      </div>
                      <div className="row-actions">
                        <button type="button" className="ghost" onClick={() => showHistory(item)}>
                          다시 보기
                        </button>
                        <button
                          type="button"
                          className="ghost"
                          aria-pressed={item.daily}
                          onClick={() => toggleDaily(item)}
                        >
                          {item.daily ? "매일 점검 해제" : "매일 점검에 쓰기"}
                        </button>
                      </div>
                    </div>
                    <p className="history-desc">{item.description}</p>
                  </li>
                ))}
              </ol>
            )}
          </section>
        )}

        {me && !me.mustChangePassword && <CheckRecords refreshKey={checksKey} />}
      </main>

      <footer className="site-foot">
        <div className="foot-inner">
          <p className="foot-brand">반장노트</p>
          <div className="foot-text">
            <p>작업을 말로 설명하면 위험성평가표 초안을 만들어 드려요. 초안은 코드가 한 번 더 검사합니다.</p>
            <p>
              참고 자료: 한국가스공사 위험성평가 표준모델(공공데이터포털). 위험성 판단은 고용노동부 「사업장 위험성평가에 관한
              지침」의 3×3 빈도·강도법을 따릅니다.
            </p>
            <p>반장노트가 만드는 것은 초안입니다. 위험성평가의 최종 판단과 책임은 사업주에게 있어요.</p>
          </div>
        </div>
      </footer>
    </>
  );
}

const LEVEL_SHORT: Record<RiskLevel, string> = { 높음: "높음", 보통: "보통", 낮음: "낮음" };

function Risk({ l, s }: { l: number; s: number }) {
  const lv = riskLevel(l, s);
  return (
    <span className="risk-mark">
      <span className={`risk-dot ${LEVEL_CLASS[lv]}`} aria-hidden="true" />
      <span className="risk-text">
        {LEVEL_SHORT[lv]} {l * s}
      </span>
      <span className="risk-calc">
        가능성 {l} × 중대성 {s}
      </span>
    </span>
  );
}

// 결과: 인쇄해서 바로 쓸 수 있는 위험성평가표 서식
function ResultView({
  result,
  me,
  cell,
  onClear,
  historyId,
  onCheckSaved,
}: {
  result: AssessResponse;
  me: Me | null;
  cell: Cell;
  onClear: () => void;
  historyId: number | null;
  onCheckSaved: () => void;
}) {
  const { assessment, report } = result;
  // 매트릭스에서 고른 칸이 있으면 그 칸 항목만 (번호는 원래 순서 유지)
  const rows = assessment.항목
    .map((it, i) => ({ it, i }))
    .filter(({ it }) => {
      if (!cell) return true;
      const c = cellOf(it, cell.phase);
      return c.l === cell.l && c.s === cell.s;
    });
  const today = new Date().toLocaleDateString("sv-SE"); // YYYY-MM-DD

  return (
    <section className="result" aria-labelledby="doc-title">
      {(result.notice || result.saved) && (
        <div className="doc-notes">
          {result.notice && <p className="notice">{result.notice}</p>}
          {result.saved && <p className="ok">우리 회사 기록에 저장했어요.</p>}
        </div>
      )}

      <article className="paper">
        <header className="doc-head">
          <div>
            <h2 id="doc-title">위험성평가표</h2>
            <p className="doc-basis">사업장 위험성평가에 관한 지침(고용노동부 고시 제2023-19호) 빈도·강도법 3×3</p>
          </div>
          <div className="doc-side">
            <div className="row-actions doc-actions">
              <button type="button" className="ghost" onClick={() => downloadCsv(assessment)}>
                <DownloadIcon size={16} />
                CSV 내려받기
              </button>
              <button
                type="button"
                className="primary"
                onClick={() => {
                  // 칸을 골라 거른 상태여도 인쇄는 전체 평가표로
                  onClear();
                  setTimeout(() => window.print(), 50);
                }}
              >
                <PrinterIcon size={16} />
                인쇄하기
              </button>
            </div>
            <div className={`stamp ${report.ok ? "pass" : "fail"}`} role="img" aria-label={`코드 검사 ${report.ok ? "통과" : "불통과"}`}>
              <span className="stamp-label">코드 검사</span>
              <span className="stamp-value">{report.ok ? "통과" : "불통과"}</span>
            </div>
          </div>
        </header>

        <dl className="doc-meta">
          <div>
            <dt>사업장</dt>
            <dd>{me?.companyName ?? " "}</dd>
          </div>
          <div>
            <dt>평가일</dt>
            <dd>{today}</dd>
          </div>
          <div>
            <dt>작업명</dt>
            <dd>{assessment.작업명}</dd>
          </div>
          <div>
            <dt>만든 방식</dt>
            <dd>{result.mode === "ai" ? `AI 초안, 모델 ${result.model}` : MODES[result.mode]}</dd>
          </div>
        </dl>

        <CheckView report={report} searchMode={result.mode === "search"} />

        {cell && (
          <p className="filter-bar" role="status">
            {cell.phase === "after" ? "대책 후" : "지금"} 가능성 {cell.l} × 중대성 {cell.s} 칸의 항목 {rows.length}개만 보고
            있어요.
            <button type="button" className="ghost small" onClick={onClear}>
              전체 보기
            </button>
          </p>
        )}

        <div className="table-wrap" id="result-table">
          <table className="doc-table">
            <thead>
              <tr>
                <th scope="col">번호</th>
                <th scope="col">세부작업</th>
                <th scope="col">유해·위험요인</th>
                <th scope="col">현재 위험성</th>
                <th scope="col">감소대책</th>
                <th scope="col">개선 후</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ it, i }) => {
                const src = result.sources?.[i];
                return (
                  <tr key={i}>
                    <td className="num" data-label="번호">
                      {i + 1}
                    </td>
                    <td className="task" data-label="세부작업">
                      {it.세부작업}
                      <span className="sub">{it.분류}</span>
                    </td>
                    <td className="hazard" data-label="유해·위험요인">
                      {it.유해위험요인}
                      {it.원인 && <span className="sub">원인: {it.원인}</span>}
                      {src && <span className="sub">표준모델: {src.표준모델_작업}</span>}
                      {it.관련근거 && <span className="law-ref">근거: {it.관련근거}</span>}
                    </td>
                    <td className="risk before" data-label="현재 위험성">
                      <Risk l={it.가능성} s={it.중대성} />
                    </td>
                    <td className="measures" data-label="감소대책">
                      {it.감소대책.length ? (
                        <ul>
                          {it.감소대책.map((m, j) => (
                            <li key={j}>{m}</li>
                          ))}
                        </ul>
                      ) : (
                        <span className="sub">감소대책이 없어요</span>
                      )}
                    </td>
                    <td className="risk after" data-label="개선 후">
                      <Risk l={it.개선후가능성} s={it.개선후중대성} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="signoff">
          <div>
            <span className="signoff-label">평가한 사람</span>
            <span className="signoff-value">{me?.name ?? ""}</span>
          </div>
          <div>
            <span className="signoff-label">근로자 확인</span>
            <span className="signoff-value" />
          </div>
          <div>
            <span className="signoff-label">사업주 확인</span>
            <span className="signoff-value" />
          </div>
        </div>

        <p className="doc-foot">
          <InfoIcon size={14} />
          초안입니다. 이 작업을 하는 근로자와 함께 확인하고 현장에 맞게 고치세요. 위험성평가의 최종 판단과 책임은 사업주에게
          있습니다.
          {result.mode === "search" && " 표준모델 검색 초안의 가능성·중대성은 규칙으로 정한 기본값입니다."}
        </p>
      </article>

      <SifCases assessment={result.assessment} />
      <DailyCheck
        assessment={result.assessment}
        signedIn={!!me && !me.mustChangePassword}
        historyId={historyId}
        onSaved={onCheckSaved}
      />
      <SafetySummary assessment={result.assessment} signedIn={!!me && !me.mustChangePassword} />
    </section>
  );
}

function CheckView({ report, searchMode }: { report: ValidationReport; searchMode: boolean }) {
  if (report.ok && report.warnings.length === 0) return null;
  return (
    <div className={`check ${report.ok ? "pass" : "fail"}`}>
      <p className="check-title">
        {report.ok ? <CheckCircleIcon size={18} /> : <AlertIcon size={18} />}
        {report.ok ? "검사는 통과했고, 사람이 확인할 것이 있어요" : `고쳐야 할 오류 ${report.errors.length}개`}
        {report.warnings.length > 0 && !report.ok && `, 확인할 것 ${report.warnings.length}개`}
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
      {searchMode && report.warnings.length > 0 && <p className="hint">표준모델에 없는 조항은 국가법령정보센터에서 원문을 확인하세요.</p>}
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
