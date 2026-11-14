"""API 없는 평가표 초안: 표준모델 검색 기반 (비용 0원).

작업 설명을 구절로 나누고, 구절마다 표준모델(data/standard_models.csv)에서 비슷한 위험요인을 찾아
ASSESSMENT_SCHEMA 형식의 평가표를 만든 뒤 src/validator.py로 검사한다.

- 검색: 글자 2개씩 자른 조각(바이그램)으로 BM25 점수 계산. 한국어 형태소 분석기 없이도 잘 맞는다.
- 표준모델에 없는 설비(프레스, 솔벤트 등)는 SYNONYMS 사전으로 비슷한 위험 단어를 덧붙여 찾는다.
- 표준모델에는 가능성·중대성 점수가 비어 있어서, 점수는 규칙으로 정한 '기본값'이다. 사람이 확인해야 한다.
  중대성: 유해위험요인 문장의 사고 유형(추락·감전·끼임 → 3 등)
  가능성: 기본 2, 작업 설명에 '없다·안 쓴다·혼자' 같은 말이 있으면 3. 대책 후 가능성은 1.

실행:
  python -m src.retrieve_draft --example
  python -m src.retrieve_draft "지게차로 자재를 옮기고 그라인더로 버를 갈아냅니다."
"""

import argparse
import json
import math
import re
import sys
from collections import Counter
from datetime import datetime
from functools import lru_cache
from pathlib import Path

import pandas as pd

from src.schema import CATEGORIES, extract_law_refs, risk_level
from src.validator import Report, validate

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data" / "standard_models.csv"
DRAFTS_DIR = ROOT / "logs" / "drafts"
VERSION = "retrieve-v1"

PER_CLAUSE = 4        # 구절 하나당 가져올 항목 수
MIN_SCORE = 12.0      # 이보다 낮은 점수는 관련 없다고 본다 (예시 설명으로 맞춘 값)
RELATIVE_CUT = 0.6    # 구절 안에서 1등 점수의 60% 미만은 버린다
DUP_SIMILARITY = 0.55  # 유해위험요인 문장이 이만큼 겹치면 중복으로 본다
COMMON_QUERY = "작업장 바닥 통로 넘어짐 미끄러짐 걸림 중량물 운반 요통"

# 작업 설명에 자주 나오지만 표준모델에 단어가 없거나 드문 설비 → 검색에 덧붙일 말
SYNONYMS = {
    "프레스": "기계 끼임 협착 방호장치 손 끼임",
    "금형": "기계 끼임 협착 중량물 낙하",
    "솔벤트": "유기용제 화학물질 세척 흡입 화재",
    "신너": "유기용제 화학물질 화재",
    "시너": "유기용제 화학물질 화재",
    "세척": "세척 유기용제 화학물질",
    "연마": "연삭 그라인더 비산 회전체",
    "바렐": "회전체 기계 끼임 소음",
    # '선반'은 공작기계와 물건 놓는 선반이 헷갈려서 넣지 않는다
    "선반기": "회전체 말림 기계 끼임",
    "밀링": "회전체 기계 끼임 비산",
    "컨베이어": "기계 끼임 협착 회전체",
    "소음": "소음 청력 귀마개",
    "코일": "중량물 낙하 깔림",
    "철판": "베임 중량물 낙하",
    "페달": "기계 오작동 끼임",
    "도장": "도장 유기용제 화재",
    "용접": "용접 화재 흄 감전",
    "분전반": "감전 누전차단기",
}

# 작업 설명 구절에 있으면 가능성을 3(자주)으로 올리는 말
RISKY_CUES = ["없", "안 쓰", "안 씁", "안쓰", "안 함", "미설치", "미착용", "혼자", "1대에만", "한 대만", "잘 안"]

# 유해위험요인 문장 → 중대성. 위에서부터 먼저 맞는 것을 쓴다.
SEVERITY_RULES = [
    (3, ["추락", "감전", "끼임", "끼여", "협착", "깔림", "말림", "폭발", "화재", "질식", "중독", "붕괴",
         "절단", "사망", "전복", "충돌", "부딪", "낙하", "맞음"]),
    (2, ["넘어", "미끄러", "베임", "베일", "화상", "요통", "근골격", "소음", "청력", "비산", "흡입", "찔림",
         "전도", "타박"]),
]


def _clean(s: str) -> str:
    s = str(s).replace("_x000D_", "")
    return re.sub(r"\s+", " ", s).strip()


def _strip_number(s: str) -> str:
    return re.sub(r"^\s*(\d+(\.\d+)*[.)]?|[-·•※○])\s*", "", s).strip()


def _bigrams(text: str) -> list[str]:
    out = []
    for word in re.findall(r"[가-힣A-Za-z0-9]+", text):
        out += [word] if len(word) == 1 else [word[i:i + 2] for i in range(len(word) - 1)]
    return out


PARTICLE = re.compile(r"(에서|으로|에게|까지|부터|처럼|이나|은|는|이|가|을|를|에|로|와|과|도|만|의)$")
VERB_ENDING = re.compile(r"(니다|는데|지만|어서|아서|면서|하며|하는|되는|있는|없는|았고|었고|[가-힣]{2}고)$")
STOPWORDS = {"작업자", "직원", "공장", "회사", "사람", "오전", "오후", "한번", "정도", "하루", "그리고"}


def _query_terms(clause: str) -> str:
    """작업 설명 구절에서 명사 비슷한 말만 남긴다. 어미·조사·숫자가 엉뚱한 행과 맞는 것을 막는다.
    예: '80톤 기계식 프레스 2대로 브래킷을 찍습니다' → '기계식 프레스 브래킷'"""
    keep = []
    for w in re.findall(r"[가-힣A-Za-z0-9]+", clause):
        if re.search(r"\d", w) or VERB_ENDING.search(w) and w not in SYNONYMS:
            continue
        w = PARTICLE.sub("", w) if len(w) > 2 else w
        if len(w) >= 2 and w not in STOPWORDS:
            keep.append(w)
    return " ".join(keep)


@lru_cache
def _index():
    df = pd.read_csv(DATA, dtype=str).fillna("")
    df = df[df["분류(정리)"].isin(CATEGORIES) & (df["유해위험요인"].str.strip() != "")].reset_index(drop=True)
    docs = [Counter(_bigrams(" ".join([r["세부작업"], r["유해위험요인"], r["원인"], r["유해위험요인"]])))
            for _, r in df.iterrows()]  # 유해위험요인은 두 번 넣어 가중치를 준다
    df_count = Counter(t for d in docs for t in d)
    avg_len = sum(sum(d.values()) for d in docs) / len(docs)
    return df, docs, df_count, avg_len


def search(query: str, k: int, min_score: float = MIN_SCORE) -> list[tuple[int, float]]:
    """BM25. (행 번호, 점수)를 점수 높은 순으로."""
    df, docs, df_count, avg_len = _index()
    n = len(docs)
    q = Counter(_bigrams(query))
    scores = []
    for i, d in enumerate(docs):
        length = sum(d.values())
        s = 0.0
        for t in q:
            f = d.get(t, 0)
            if f:
                idf = math.log(1 + (n - df_count[t] + 0.5) / (df_count[t] + 0.5))
                s += idf * f * 2.2 / (f + 1.2 * (0.25 + 0.75 * length / avg_len))
        if s >= min_score:
            scores.append((i, s))
    return sorted(scores, key=lambda x: -x[1])[:k]


def split_clauses(description: str) -> list[str]:
    parts = re.split(r"[.!?\n]+|,\s*|\s+(?:그리고|그 다음|끝나면)\s+", description)
    return [p.strip() for p in parts if len(p.strip()) >= 4]


def _expand(clause: str) -> str:
    extra = [v for k, v in SYNONYMS.items() if k in clause]
    return " ".join([_query_terms(clause), *extra])


def _severity(hazard: str) -> int:
    for level, words in SEVERITY_RULES:
        if any(w in hazard for w in words):
            return level
    return 2


def _likelihood(clause: str) -> int:
    return 3 if any(c in clause for c in RISKY_CUES) else 2


def _similar(a: str, b: str) -> float:
    x, y = set(_bigrams(a)), set(_bigrams(b))
    return len(x & y) / max(1, min(len(x), len(y)))


def _short(clause: str, n: int = 30) -> str:
    return clause if len(clause) <= n else clause[:n - 1] + "…"


def _measures(raw: str) -> list[str]:
    """번호·기호가 붙은 줄에서만 나눈다. 엑셀 칸 안의 줄바꿈은 문장 중간일 수 있다."""
    text = str(raw).replace("_x000D_", "").replace("\r", "")
    parts = re.split(r"\n(?=\s*(?:\d+[.)]|[-·•※○ㅇ]\s))", text)
    out = [re.sub(r"^\s*ㅇ\s+", "", _strip_number(_clean(p))) for p in parts]
    return list(dict.fromkeys(x for x in out if x))


def _cause(raw: str) -> str:
    c = _strip_number(_clean(raw))
    return c or "표준모델 참고"


def _item(row, clause: str) -> dict:
    hazard = _clean(row["유해위험요인"])
    sev = _severity(hazard)
    like = _likelihood(clause)
    measures = _measures(row["감소대책"])
    refs = extract_law_refs(row["관련근거"]) or [r for r in row["법조항"].split(";") if r]
    return {
        "세부작업": _short(clause),
        "분류": row["분류(정리)"],
        "원인": _cause(row["원인"]),
        "유해위험요인": hazard,
        "관련근거": ", ".join(refs),
        "현재조치": "",
        "가능성": like,
        "중대성": sev,
        "감소대책": measures,
        # 대책을 이행하면 가능성을 1로 본다. 대책이 없으면 그대로 둔다.
        "개선후가능성": 1 if measures else like,
        "개선후중대성": sev,
    }


def draft(description: str, title: str = "", include_common: bool = True) -> dict:
    """작업 설명 → {'평가표', '검사', '출처'}. 출처는 항목마다 표준모델의 어느 행을 썼는지."""
    if not description.strip():
        raise ValueError("작업 설명이 비어 있습니다")
    df = _index()[0]
    items, sources = [], []

    def add(clause: str, hits):
        for i, score in hits:
            row = df.iloc[i]
            hazard = _clean(row["유해위험요인"])
            if any(_similar(hazard, it["유해위험요인"]) >= DUP_SIMILARITY for it in items):
                continue
            items.append(_item(row, clause))
            sources.append({"구절": clause, "점수": round(score, 1), "표준모델_작업": _clean(row["작업명"]),
                            "표준모델_세부작업": _clean(row["세부작업"]), "파일": row["출처파일"]})

    prev_start = 0
    for clause in split_clauses(description):
        hits = search(_expand(clause), PER_CLAUSE)
        # 구절의 1등 점수보다 많이 낮은 것은 버린다 (억지로 채운 항목 방지)
        hits = [h for h in hits if h[1] >= RELATIVE_CUT * hits[0][1]] if hits else []
        if not hits:
            # '방호장치는 1대에만', '반장이 혼자 합니다'처럼 찾을 게 없는 구절은
            # 바로 앞 구절의 작업을 보충 설명하는 경우가 많다 → 앞 항목들의 가능성을 올린다
            if _likelihood(clause) == 3:
                for it in items[prev_start:]:
                    it["가능성"] = 3
            continue
        prev_start = len(items)
        add(clause, hits)
    if include_common:
        add("공통(작업장 전반)", search(COMMON_QUERY, 2))

    assessment = {"작업명": title or _short(split_clauses(description)[0] if split_clauses(description) else description, 20),
                  "항목": items}
    return {"평가표": assessment, "검사": validate(assessment), "출처": sources}


def print_result(result: dict) -> None:
    a, rep = result["평가표"], result["검사"]
    print(f"\n■ {a['작업명']}  ({len(a['항목'])}개 항목, 표준모델 검색 · API 미사용)")
    for n, (it, src) in enumerate(zip(a["항목"], result["출처"]), 1):
        before = risk_level(it["가능성"], it["중대성"])
        after = risk_level(it["개선후가능성"], it["개선후중대성"])
        print(f"{n:2}. [{it['분류']}] {it['세부작업']}")
        print(f"    {it['유해위험요인']}")
        print(f"    위험성 {before}({it['가능성']}x{it['중대성']}) → {after}({it['개선후가능성']}x{it['개선후중대성']})"
              f"  근거: {it['관련근거'] or '-'}")
        for m in it["감소대책"]:
            print(f"    · {m}")
        print(f"    (출처: {src['표준모델_작업']} / {src['표준모델_세부작업'][:20]}, 점수 {src['점수']})")
    print("\n검사:", "통과" if rep.ok else "불통과")
    for e in rep.errors:
        print("  오류:", e)
    for w in rep.warnings:
        print("  확인 필요:", w)
    print("\n※ 가능성·중대성은 규칙으로 정한 기본값입니다. 현장 상황을 보고 고치세요.")


def save(result: dict, description: str) -> str:
    DRAFTS_DIR.mkdir(parents=True, exist_ok=True)
    path = DRAFTS_DIR / f"{datetime.now():%Y%m%d-%H%M%S}_retrieve.json"
    rep: Report = result["검사"]
    path.write_text(json.dumps({
        "버전": VERSION, "작업설명": description,
        "검사": {"통과": rep.ok, "오류": rep.errors, "확인필요": rep.warnings},
        "평가표": result["평가표"], "출처": result["출처"],
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    return str(path.relative_to(ROOT))


EXAMPLE = (
    "직원 12명인 금속 부품 공장입니다. 오전에 지게차로 철판 코일을 창고에서 꺼내 프레스 옆으로 옮기고, "
    "80톤 기계식 프레스 2대로 브래킷을 찍습니다. 작업자가 손으로 철판을 넣고 발 페달로 작동시키는데, "
    "광전자식 방호장치는 1대에만 달려 있습니다. 찍은 부품은 바렐 연마기에 넣고, 끝나면 세척조에서 "
    "솔벤트로 기름을 닦아냅니다. 프레스 소음이 커서 귀마개를 나눠주지만 잘 안 씁니다. "
    "금형 교체는 한 달에 두세 번, 반장이 혼자 합니다."
)


def main() -> None:
    p = argparse.ArgumentParser(description="표준모델 검색 기반 평가표 초안 (API 미사용)")
    p.add_argument("description", nargs="?", help="작업 설명")
    p.add_argument("--example", action="store_true", help="예시 작업 설명 사용")
    p.add_argument("--title", default="", help="작업명")
    p.add_argument("--no-common", action="store_true", help="공통 위험(넘어짐·중량물) 넣지 않음")
    args = p.parse_args()
    desc = EXAMPLE if args.example else (args.description or sys.stdin.read())
    result = draft(desc, title=args.title or ("프레스 성형 작업" if args.example else ""),
                   include_common=not args.no_common)
    print_result(result)
    print(f"\n저장: {save(result, desc)}")


if __name__ == "__main__":
    main()
