"use client";

// 3×3 위험성 매트릭스 (가능성 × 중대성)
// - 평가표가 없을 때: 점수 판단 기준을 보여 준다 (칸 숫자 = 가능성 × 중대성)
// - 평가표가 있을 때: "지금"과 "대책을 하면" 두 장을 나란히 그리고, 칸마다 항목 수를 보여 준다.
//   칸을 누르면 그 칸의 항목만 아래 평가표에 남는다.
import { LIKELIHOOD, SEVERITY, riskLevel, type AssessmentItem, type RiskLevel } from "@/lib/schema";

export type Phase = "before" | "after";
export type Cell = { l: number; s: number; phase: Phase } | null;

const LEVEL_CLASS: Record<RiskLevel, string> = { 높음: "high", 보통: "mid", 낮음: "low" };
const short = (label: string) => label.replace(/\(.*\)/, "");

export function cellOf(it: AssessmentItem, phase: Phase): { l: number; s: number } {
  return phase === "before" ? { l: it.가능성, s: it.중대성 } : { l: it.개선후가능성, s: it.개선후중대성 };
}

export function MatrixGrid({
  title,
  items,
  phase,
  selected,
  onSelect,
}: {
  title: string;
  items: AssessmentItem[] | null;
  phase: Phase;
  selected?: Cell;
  onSelect?: (c: Cell) => void;
}) {
  const counts = new Map<string, number>();
  for (const it of items ?? []) {
    const { l, s } = cellOf(it, phase);
    counts.set(`${l}-${s}`, (counts.get(`${l}-${s}`) ?? 0) + 1);
  }
  const live = !!items && !!onSelect;
  const titleId = `matrix-${phase}-${live ? "live" : "key"}`;

  return (
    <figure className="matrix" aria-labelledby={titleId}>
      <figcaption id={titleId} className="matrix-title">
        {title}
      </figcaption>
      <div className="matrix-body">
        <span className="axis-y" aria-hidden="true">
          중대성
        </span>
        <div className="matrix-grid" role="group" aria-label={`${title}: 가능성과 중대성별 항목`}>
          {[3, 2, 1].map((s) => (
            <div className="matrix-row" key={s}>
              <span className="tick-y" title={SEVERITY[s]}>
                {short(SEVERITY[s])}
              </span>
              {[1, 2, 3].map((l) => {
                const level = riskLevel(l, s);
                const n = counts.get(`${l}-${s}`) ?? 0;
                const isSel = selected?.phase === phase && selected.l === l && selected.s === s;
                const label = `가능성 ${l}, 중대성 ${s}, 위험성 ${level}${live ? `, ${n}개 항목` : ""}`;
                const content = (
                  <>
                    <span className="score">{l * s}</span>
                    {live && <span className="count">{n > 0 ? `${n}개` : "–"}</span>}
                  </>
                );
                return live ? (
                  <button
                    key={l}
                    type="button"
                    className={`matrix-cell ${LEVEL_CLASS[level]}${n === 0 ? " empty" : ""}`}
                    aria-pressed={isSel}
                    aria-label={label}
                    disabled={n === 0}
                    onClick={() => onSelect(isSel ? null : { l, s, phase })}
                  >
                    {content}
                  </button>
                ) : (
                  <div key={l} className={`matrix-cell ${LEVEL_CLASS[level]}`} aria-label={label} role="img">
                    {content}
                  </div>
                );
              })}
            </div>
          ))}
          <div className="matrix-row ticks-x" aria-hidden="true">
            <span className="tick-y" />
            {[1, 2, 3].map((l) => (
              <span key={l} className="tick-x" title={LIKELIHOOD[l]}>
                {short(LIKELIHOOD[l])}
              </span>
            ))}
          </div>
          <p className="axis-x" aria-hidden="true">
            가능성
          </p>
        </div>
      </div>
    </figure>
  );
}

export function MatrixLegend() {
  return (
    <dl className="matrix-legend">
      <div>
        <dt className="swatch high" />
        <dd>
          <b>높음</b> 6~9점, 작업 전에 대책
        </dd>
      </div>
      <div>
        <dt className="swatch mid" />
        <dd>
          <b>보통</b> 3~4점, 대책을 세워 줄이기
        </dd>
      </div>
      <div>
        <dt className="swatch low" />
        <dd>
          <b>낮음</b> 1~2점, 지금 관리 유지
        </dd>
      </div>
    </dl>
  );
}

// 대책 전후를 한 문장으로: "위험성 높음 13개가 대책 후 0개로 줄어요"
export function summarize(items: AssessmentItem[]) {
  const count = (phase: Phase, lv: RiskLevel) =>
    items.filter((it) => {
      const { l, s } = cellOf(it, phase);
      return riskLevel(l, s) === lv;
    }).length;
  const hb = count("before", "높음");
  const ha = count("after", "높음");
  const mb = count("before", "보통");
  const ma = count("after", "보통");
  const fatal = items.filter((it) => it.개선후중대성 === 3).length;
  const headline =
    hb > 0
      ? `위험성 높음 ${hb}개가 대책 후 ${ha}개로 줄어요`
      : mb > 0
        ? `높음은 없고, 보통 ${mb}개가 대책 후 ${ma}개로 줄어요`
        : "모든 항목이 이미 낮음이에요";
  const detail =
    ha > 0
      ? `대책 후에도 높음이 ${ha}개 남아요. 작업을 멈추거나 대책을 더 세워야 해요.`
      : fatal > 0
        ? `치명적인 사고(중대성 3) ${fatal}개는 대책을 해도 중대성이 그대로라, 가능성을 낮게 유지하는 관리가 계속 필요해요.`
        : "대책을 하면 모든 항목이 보통 이하가 돼요.";
  return { headline, detail };
}
