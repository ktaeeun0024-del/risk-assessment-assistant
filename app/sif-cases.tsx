"use client";

// 비슷한 사망사고 사례 (11/22): 평가표 항목과 비슷한 실제 사고를 안전보건공단 SIF 아카이브에서 찾아 보여 준다.
// 검색은 서버(lib/sif.ts)가 한다. 비슷한 사례가 없으면 아무것도 그리지 않는다.
import { useEffect, useState } from "react";
import type { SifMatch } from "@/lib/sif";
import type { Assessment } from "@/lib/schema";
import { AlertIcon } from "./icons";
import { More } from "./more";

export function SifCases({ assessment }: { assessment: Assessment }) {
  const [cases, setCases] = useState<SifMatch[]>([]);
  const [source, setSource] = useState("");

  useEffect(() => {
    const items = assessment.항목.map((it) => ({
      세부작업: it.세부작업,
      원인: it.원인,
      유해위험요인: it.유해위험요인,
      점수: it.가능성 * it.중대성,
    }));
    const ctrl = new AbortController();
    fetch("/api/sif", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
      signal: ctrl.signal,
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        setCases(data?.cases ?? []);
        setSource(data?.source ?? "");
      })
      .catch(() => undefined);
    return () => ctrl.abort();
  }, [assessment]);

  if (cases.length === 0) return null;

  return (
    <section className="sif" aria-labelledby="sif-title">
      <h2 id="sif-title">
        <AlertIcon size={18} />
        비슷한 실제 사망·중상 사고
      </h2>
      <p className="hint">
        이 평가표의 위험요인과 비슷한 실제 사고예요. 감소대책을 미루면 이런 일이 일어날 수 있어요. 대책 예시는 평가표를 고칠 때
        참고하세요.
      </p>
      <More total={cases.length} limit={1} unit="건">
      <ol className="more-items sif-list">
        {cases.map((m, i) => (
          <li key={i}>
            <p className="sif-meta">
              {[m.case.업종, m.case.단위작업 || m.case.작업, m.case.기인물 && `기인물: ${m.case.기인물}`].filter(Boolean).join(" / ")}
            </p>
            <p className="sif-overview">{m.case.개요}</p>
            <dl>
              {(m.case.유발요인 || m.case.고위험상황) && (
                <>
                  <dt>왜 일어났나</dt>
                  <dd>{m.case.유발요인 || m.case.고위험상황}</dd>
                </>
              )}
              {m.case.감소대책 && (
                <>
                  <dt>대책 예시</dt>
                  <dd className="sif-measures">{m.case.감소대책}</dd>
                </>
              )}
              <dt>평가표의 비슷한 항목</dt>
              <dd className="sif-item">{m.item}</dd>
            </dl>
          </li>
        ))}
      </ol>
      </More>
      <p className="sif-source">출처: {source}</p>
    </section>
  );
}
