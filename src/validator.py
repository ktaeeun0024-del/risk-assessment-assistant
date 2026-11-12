"""평가표 검사기: AI가 쓴 위험성평가표를 코드가 다시 검사한다.

원칙: AI가 쓰고 코드가 검증한다. 검사 결과는 '오류'(고쳐야 함)와 '확인 필요'(사람이 볼 것)로 나눈다.
실행: python -m src.validator  → 일부러 틀린 예시 평가표로 검사기 동작 확인
"""

from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

import pandas as pd

from src.schema import CATEGORIES, extract_law_refs, risk_level

DATA = Path(__file__).resolve().parent.parent / "data" / "standard_models.csv"
REQUIRED_TEXT = ["세부작업", "원인", "유해위험요인"]
LEVEL_ORDER = {"낮음": 0, "보통": 1, "높음": 2}


@dataclass
class Report:
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.errors


@lru_cache
def known_law_refs() -> set[str]:
    """표준모델에 실제로 인용된 법 조항 목록. 여기에 없다고 틀린 건 아니라서 '확인 필요'로만 쓴다."""
    if not DATA.exists():
        return set()
    df = pd.read_csv(DATA, dtype=str).fillna("")
    return {r for s in df["법조항"] for r in s.split(";") if r}


def validate(assessment: dict) -> Report:
    rep = Report()
    items = assessment.get("항목", [])
    if not items:
        rep.errors.append("평가 항목이 하나도 없습니다")
    seen = set()
    for n, it in enumerate(items, 1):
        tag = f"{n}번 항목"
        for k in REQUIRED_TEXT:
            if not str(it.get(k, "")).strip():
                rep.errors.append(f"{tag}: '{k}'이(가) 비어 있습니다")
        if it.get("분류") not in CATEGORIES:
            rep.errors.append(f"{tag}: 분류 '{it.get('분류')}'은(는) KRAS 6분류가 아닙니다")
        try:
            before = risk_level(int(it["가능성"]), int(it["중대성"]))
            after = risk_level(int(it["개선후가능성"]), int(it["개선후중대성"]))
        except (KeyError, TypeError, ValueError):
            rep.errors.append(f"{tag}: 가능성·중대성은 1~3 숫자여야 합니다")
            continue
        measures = [m for m in it.get("감소대책", []) if str(m).strip()]
        if before in ("높음", "보통") and not measures:
            rep.errors.append(f"{tag}: 위험성 '{before}'인데 감소대책이 없습니다")
        if LEVEL_ORDER[after] > LEVEL_ORDER[before]:
            rep.errors.append(f"{tag}: 개선 후 위험성({after})이 개선 전({before})보다 높습니다")
        if before == "높음" and after == "높음":
            rep.warnings.append(f"{tag}: 대책 후에도 위험성이 '높음'입니다. 작업 중지나 추가 대책을 검토하세요")
        if int(it["중대성"]) == 3 and int(it["개선후중대성"]) == 3 and int(it["개선후가능성"]) >= 2:
            rep.warnings.append(f"{tag}: 치명적 사고 가능성이 남아 있습니다")
        refs = extract_law_refs(it.get("관련근거", ""))
        if it.get("관련근거") and not refs:
            rep.warnings.append(f"{tag}: 관련근거 '{it['관련근거'][:30]}'에서 법 조항 번호를 찾지 못했습니다")
        unknown = [r for r in refs if known_law_refs() and r not in known_law_refs()]
        if unknown:
            rep.warnings.append(f"{tag}: {', '.join(unknown)}은(는) 표준모델에 없는 조항입니다. 실제 조문을 확인하세요")
        key = (it.get("세부작업"), it.get("유해위험요인"))
        if key in seen:
            rep.warnings.append(f"{tag}: 앞 항목과 중복됩니다")
        seen.add(key)
    return rep


if __name__ == "__main__":
    sample = {"작업명": "지게차 작업", "항목": [
        {"세부작업": "화물 운반", "분류": "기계적 요인", "원인": "후진 시 시야 미확보",
         "유해위험요인": "지게차 후진 중 보행자와 부딪힘", "관련근거": "안전보건규칙 제172조",
         "현재조치": "", "가능성": 3, "중대성": 3, "감소대책": ["후진경보기 설치", "유도자 배치"],
         "개선후가능성": 1, "개선후중대성": 3},
        {"세부작업": "화물 적재", "분류": "기계 요인", "원인": "과적",
         "유해위험요인": "화물 낙하", "관련근거": "안전보건규칙 제9999조",
         "현재조치": "", "가능성": 2, "중대성": 3, "감소대책": [],
         "개선후가능성": 3, "개선후중대성": 3},
    ]}
    r = validate(sample)
    print("통과" if r.ok else "불통과")
    for e in r.errors:
        print("  오류:", e)
    for w in r.warnings:
        print("  확인 필요:", w)
