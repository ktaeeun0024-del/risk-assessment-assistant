"""위험성평가표 형식(스키마)과 공통 규칙.

근거: 사업장 위험성평가에 관한 지침(고용노동부 고시 제2023-19호)은 빈도·강도법, 체크리스트법,
위험성 수준 3단계 판단법, 핵심요인 기술법 중 하나 이상을 골라 쓰게 한다.
이 도구는 소규모 사업장이 쓰기 쉬운 3x3 빈도·강도법(가능성 1~3 x 중대성 1~3)을 쓰고
결과를 낮음/보통/높음 3단계로 나눈다. 항목 구성은 안전보건공단 KRAS 양식을 따른다.
"""

import re

# KRAS 유해·위험요인 분류 6가지
CATEGORIES = ["기계적 요인", "전기적 요인", "화학(물질)적 요인", "생물학적 요인", "작업특성 요인", "작업환경 요인"]

LIKELIHOOD = {1: "낮음(거의 없음)", 2: "보통(가끔 발생 가능)", 3: "높음(자주 발생 가능)"}
SEVERITY = {1: "경미(치료 후 바로 복귀)", 2: "중간(휴업이 필요한 부상)", 3: "치명(사망·장해·직업병)"}


def risk_level(likelihood: int, severity: int) -> str:
    score = likelihood * severity
    return "높음" if score >= 6 else "보통" if score >= 3 else "낮음"


def normalize_category(raw: str) -> str:
    s = re.sub(r"^\d+\.\s*|\s+", "", str(raw))
    for key, cat in [("기계", "기계적 요인"), ("전기", "전기적 요인"), ("화학", "화학(물질)적 요인"),
                     ("생물", "생물학적 요인"), ("작업특성", "작업특성 요인"), ("작업환경", "작업환경 요인")]:
        if key in s:
            return cat
    return ""


LAW_PATTERN = re.compile(r"(안전보건규칙|산업안전보건법\s*시행규칙|산업안전보건법\s*시행령|산업안전보건법|산안법)\s*제?\s*(\d+)\s*조")


def extract_law_refs(text: str) -> list[str]:
    """'안전보건규칙 제171조 [잠금장치의 체결]' → ['안전보건규칙 제171조']"""
    out = []
    for law, num in LAW_PATTERN.findall(str(text)):
        law = re.sub(r"\s+", " ", law).replace("산안법", "산업안전보건법")
        out.append(f"{law} 제{int(num)}조")
    return list(dict.fromkeys(out))


# Claude structured outputs에 넘길 JSON 스키마 (평가표 한 장)
ASSESSMENT_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["작업명", "항목"],
    "properties": {
        "작업명": {"type": "string"},
        "항목": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["세부작업", "분류", "원인", "유해위험요인", "관련근거", "현재조치",
                             "가능성", "중대성", "감소대책", "개선후가능성", "개선후중대성"],
                "properties": {
                    "세부작업": {"type": "string"},
                    "분류": {"type": "string", "enum": CATEGORIES},
                    "원인": {"type": "string"},
                    "유해위험요인": {"type": "string", "description": "무엇 때문에 어떤 사고가 나는지 한 문장"},
                    "관련근거": {"type": "string", "description": "관련 법 조항. 확실하지 않으면 빈 문자열"},
                    "현재조치": {"type": "string", "description": "입력에 나온 현재 안전조치. 없으면 빈 문자열"},
                    "가능성": {"type": "integer", "enum": [1, 2, 3]},
                    "중대성": {"type": "integer", "enum": [1, 2, 3]},
                    "감소대책": {"type": "array", "items": {"type": "string"}},
                    "개선후가능성": {"type": "integer", "enum": [1, 2, 3]},
                    "개선후중대성": {"type": "integer", "enum": [1, 2, 3]},
                },
            },
        },
    },
}
