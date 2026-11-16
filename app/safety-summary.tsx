"use client";

// 외국인 근로자용 안전 요약 (AI ④): 쉬운 한국어 요약 → 고른 언어로 번역 → 다시 한국어로 옮겨 코드가 비교
import { useEffect, useMemo, useState } from "react";
import { isPending } from "@/lib/options";
import {
  buildKoreanSummary,
  LANGUAGES,
  type Lang,
  type TranslatedText,
  type TranslationResult,
} from "@/lib/safety-summary";
import type { Assessment, RiskLevel } from "@/lib/schema";
import { AlertIcon, CheckCircleIcon, PrinterIcon } from "./icons";

const LEVEL_CLASS: Record<RiskLevel, string> = { 높음: "high", 보통: "mid", 낮음: "low" };
// 화면의 lang 속성 (글꼴·읽기 프로그램용)
const HTML_LANG: Record<Lang, string> = { vi: "vi", km: "km", ne: "ne", id: "id", my: "my", uz: "uz", en: "en" };

export function SafetySummary({ assessment, signedIn }: { assessment: Assessment; signedIn: boolean }) {
  const source = useMemo(() => buildKoreanSummary(assessment), [assessment]);
  const [lang, setLang] = useState<Lang>("vi");
  const [loading, setLoading] = useState(false);
  const [waitSec, setWaitSec] = useState(0);
  const [error, setError] = useState("");
  // 1단계 번역 결과 (역번역 검사 전) / 2단계 검사까지 끝난 결과
  const [translated, setTranslated] = useState<TranslatedText | null>(null);
  const [result, setResult] = useState<TranslationResult | null>(null);
  const [stage, setStage] = useState<"translate" | "check" | null>(null);

  // 평가표가 바뀌면 예전 번역은 지운다
  useEffect(() => {
    setTranslated(null);
    setResult(null);
    setError("");
  }, [assessment]);

  // 한 단계 실행: 배포 사이트에서는 AI가 뒤에서 일하는 동안 3초마다 확인 (최대 약 3분)
  async function runStep<T>(step: "translate" | "check", body: object, failMessage: string): Promise<T> {
    const started = Date.now();
    setWaitSec(0);
    const res = await fetch("/api/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    let data = await res.json().catch(() => null);
    if (!res.ok && res.status !== 202) throw new Error(data?.error ?? failMessage);
    while (isPending(data) && Date.now() - started < 200_000) {
      await new Promise((r) => setTimeout(r, 3_000));
      setWaitSec(Math.round((Date.now() - started) / 1000));
      const poll = await fetch(`/api/translate?job=${data.jobId}&step=${step}`);
      const next = await poll.json().catch(() => null);
      if (!next || (!poll.ok && poll.status !== 202)) throw new Error(next?.error ?? failMessage);
      data = next;
    }
    if (isPending(data)) throw new Error("AI가 아직 작업 중이에요. 잠시 후 다시 시도해 주세요.");
    return data as T;
  }

  async function translate() {
    setLoading(true);
    setError("");
    setTranslated(null);
    setResult(null);
    try {
      setStage("translate");
      const t = await runStep<TranslatedText>("translate", { assessment, lang }, "번역을 만들지 못했어요.");
      setTranslated(t);
      setStage("check");
      setResult(await runStep<TranslationResult>("check", { assessment, step: "check", translated: t }, "역번역 검사를 하지 못했어요."));
    } catch (err) {
      setError(err instanceof TypeError ? "서버에 연결하지 못했어요." : err instanceof Error ? err.message : "번역을 만들지 못했어요.");
    } finally {
      setLoading(false);
      setStage(null);
    }
  }

  function printSummary() {
    document.body.dataset.print = "summary";
    const done = () => {
      delete document.body.dataset.print;
      window.removeEventListener("afterprint", done);
    };
    window.addEventListener("afterprint", done);
    window.print();
  }

  const checked = result?.lines.filter((l) => l.ok).length ?? 0;
  const shown = result ?? translated;

  return (
    <section className="safety-summary" aria-labelledby="summary-title">
      <div className="summary-head">
        <div>
          <h2 id="summary-title">외국인 근로자용 안전 요약</h2>
          <p className="hint">
            위험성이 높은 항목부터 {source.lines.length}개를 쉬운 문장으로 정리해 근로자의 말로 옮겨요. AI가 옮긴 글은 다시
            한국어로 되돌려 원문과 비교하고, 뜻이 달라진 줄은 &lsquo;확인 필요&rsquo;로 표시해요.
          </p>
        </div>
        <div className="summary-controls">
          <label className="lang-select">
            <span>언어</span>
            <select value={lang} onChange={(e) => setLang(e.target.value as Lang)} disabled={loading}>
              {(Object.keys(LANGUAGES) as Lang[]).map((k) => (
                <option key={k} value={k}>
                  {LANGUAGES[k].name} · {LANGUAGES[k].native}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="primary" onClick={translate} disabled={loading || !signedIn} aria-busy={loading}>
            {loading && <span className="spinner" aria-hidden="true" />}
            {loading ? (stage === "check" ? "검사하는 중…" : "옮기는 중…") : shown ? "다시 옮기기" : "이 언어로 옮기기"}
          </button>
        </div>
      </div>

      {!signedIn && <p className="hint">번역은 로그인한 회사 계정만 쓸 수 있어요. 아래 쉬운 한국어 요약은 지금도 쓸 수 있어요.</p>}
      {loading && (
        <p className="hint" aria-live="polite">
          {stage === "check"
            ? "번역문을 다시 한국어로 옮겨 원문과 비교하고 있어요."
            : "번역하고 있어요. 언어에 따라 1분 넘게 걸릴 수 있어요."}
          {waitSec > 0 && ` (${waitSec}초째)`}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          <AlertIcon size={16} />
          {error}
        </p>
      )}

      <div className="summary-sheet">
        <div className="summary-sheet-head">
          <p className="summary-title">{shown ? shown.title : source.title}</p>
          {translated && !result && loading && <p className="summary-check">역번역 검사 중…</p>}
          {result && (
            <p className={`summary-check ${result.ok ? "pass" : "fail"}`}>
              {result.ok ? <CheckCircleIcon size={16} /> : <AlertIcon size={16} />}
              역번역 검사 {checked}/{result.lines.length}줄 통과
            </p>
          )}
          {result && (
            <button type="button" className="ghost small summary-print" onClick={printSummary}>
              <PrinterIcon size={14} />
              요약 인쇄하기
            </button>
          )}
        </div>
        <ol className="summary-lines">
          {source.lines.map((src, i) => {
            const t = shown?.lines[i];
            const c = result?.lines[i];
            return (
              <li key={i} className={c && !c.ok ? "needs-check" : undefined}>
                <span className={`risk-dot ${LEVEL_CLASS[src.level]}`} title={`위험성 ${src.level}`} />
                <div className="summary-body">
                  {t && (
                    <div className="summary-target" lang={HTML_LANG[shown!.lang]}>
                      <p className="summary-risk">{t.risk}</p>
                      <p className="summary-todo">{t.todo}</p>
                    </div>
                  )}
                  <div className={t ? "summary-ko small" : "summary-ko"} lang="ko">
                    <p className="summary-risk">
                      <span className="summary-label">위험</span>
                      {src.risk}
                    </p>
                    <p className="summary-todo">
                      <span className="summary-label">지킬 것</span>
                      {src.todo}
                    </p>
                  </div>
                  {c && (
                    <details className="summary-back">
                      <summary>
                        {c.ok ? "확인됨" : `확인 필요: ${c.note}`} <span className="hint">(다시 옮긴 문장 보기)</span>
                      </summary>
                      <p>
                        {c.backRisk} / {c.backTodo}
                      </p>
                    </details>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
        {shown && (
          <p className="summary-foot">
            AI 번역입니다. &lsquo;확인 필요&rsquo; 줄은 그 언어를 아는 동료와 함께 확인한 뒤 나눠 주세요.
          </p>
        )}
      </div>
    </section>
  );
}
