"""AI ①: 작업 설명 → 위험성평가표 초안 (v1).

Claude가 ASSESSMENT_SCHEMA 형식(structured outputs)으로 평가표를 쓰고,
src/validator.py가 바로 검사한다. 오류가 있으면 오류 목록을 돌려주고 한 번 더 고쳐 쓰게 한다.

실행:
  python -m src.draft --ping                     # API 키·연결 확인 (아주 짧은 호출)
  python -m src.draft --example                  # 예시 작업 설명으로 평가표 생성
  python -m src.draft "프레스로 철판을 찍는 작업..."  # 직접 입력
  AI_MODE=eval python -m src.draft --example     # Sonnet 5.5로 실행
"""

import argparse
import json
import sys
from datetime import datetime

from src import ai_config
from src.schema import ASSESSMENT_SCHEMA, CATEGORIES, LIKELIHOOD, SEVERITY
from src.validator import Report, validate

PROMPT_VERSION = "draft-v1"
MAX_TOKENS = 16000
DRAFTS_DIR = ai_config.ROOT / "logs" / "drafts"

SYSTEM_PROMPT = f"""당신은 50인 미만 제조 사업장의 위험성평가를 돕는 산업안전 전문가입니다.
사용자는 안전 담당자가 없는 현장의 반장이나 사업주이고, 작업 내용을 말로 설명합니다.
그 설명으로 안전보건공단 KRAS 양식의 위험성평가표 초안을 작성하세요.

## 작성 방법
1. 작업을 세부작업(준비, 본작업, 정리·운반 등)으로 나누고, 세부작업마다 유해·위험요인을 찾습니다.
2. 유해·위험요인은 "무엇 때문에 → 어떤 사고가 난다"가 드러나는 한 문장으로 씁니다.
   예: "프레스 금형 사이에 손을 넣은 상태에서 슬라이드가 내려와 손가락이 끼임"
3. 분류는 다음 6가지 중 하나입니다: {", ".join(CATEGORIES)}
4. 위험성은 3x3 빈도·강도법으로 판단합니다.
   - 가능성: {"; ".join(f"{k}={v}" for k, v in LIKELIHOOD.items())}
   - 중대성: {"; ".join(f"{k}={v}" for k, v in SEVERITY.items())}
   - 가능성 x 중대성: 1~2 낮음, 3~4 보통, 6~9 높음
   - 현재조치(설명에 나온 안전조치)를 반영한 지금 상태로 판단합니다.
5. 감소대책은 현장에서 바로 할 수 있는 구체적인 행동으로 씁니다. 우선순위는
   제거·대체 → 공학적 대책(방호장치, 인터록, 국소배기) → 관리적 대책(작업절차, 교육, 표지) → 보호구 순입니다.
   위험성이 보통 이상이면 감소대책을 반드시 1개 이상 씁니다.
6. 개선후가능성·개선후중대성은 감소대책을 모두 이행했을 때를 기준으로 하며, 개선 전보다 높을 수 없습니다.
   중대성은 대책으로 잘 줄지 않으므로(사고가 나면 여전히 치명적), 보통은 가능성을 낮춥니다.
7. 관련근거에는 산업안전보건법, 산업안전보건기준에 관한 규칙(안전보건규칙)의 조항을
   "안전보건규칙 제103조" 같은 형식으로 씁니다. 조항 번호가 확실하지 않으면 빈 문자열로 둡니다.
   추측한 조항 번호는 쓰지 마세요. 틀린 조항은 빈칸보다 해롭습니다.
8. 현재조치는 설명에 나온 내용만 씁니다. 설명에 없으면 빈 문자열입니다.
9. 설명에 나온 기계·물질·작업 방식에 맞는 위험요인을 우선 찾고, 흔한 위험(넘어짐, 중량물 요통, 소음 등)도 빠뜨리지 마세요.
   같은 위험요인을 두 번 쓰지 마세요. 보통 8~20개 항목이 적당합니다.
10. 작업명은 설명을 보고 짧게 붙입니다 (예: "프레스 성형 작업").
"""

EXAMPLE = (
    "직원 12명인 금속 부품 공장입니다. 오전에 지게차로 철판 코일을 창고에서 꺼내 프레스 옆으로 옮기고, "
    "80톤 기계식 프레스 2대로 브래킷을 찍습니다. 작업자가 손으로 철판을 넣고 발 페달로 작동시키는데, "
    "광전자식 방호장치는 1대에만 달려 있습니다. 찍은 부품은 바렐 연마기에 넣고, 끝나면 세척조에서 "
    "솔벤트로 기름을 닦아냅니다. 프레스 소음이 커서 귀마개를 나눠주지만 잘 안 씁니다. "
    "금형 교체는 한 달에 두세 번, 반장이 혼자 합니다."
)


def _user_message(description: str) -> str:
    return f"다음 작업 설명으로 위험성평가표 초안을 작성하세요.\n\n<작업설명>\n{description.strip()}\n</작업설명>"


def _repair_message(rep: Report) -> str:
    lines = "\n".join(f"- {e}" for e in rep.errors)
    return ("검사기가 아래 오류를 찾았습니다. 오류를 모두 고친 평가표 전체를 다시 작성하세요. "
            f"오류가 없는 항목은 그대로 두세요.\n\n{lines}")


class DraftError(RuntimeError):
    pass


def _call(cl, model_id: str, messages: list) -> tuple[dict, object]:
    """한 번 호출해서 (평가표 dict, 응답) 을 돌려준다."""
    params = dict(
        model=model_id,
        max_tokens=MAX_TOKENS,
        # 시스템 프롬프트는 매번 같으므로 캐시 (짧으면 캐시되지 않을 뿐 오류는 아님)
        system=[{"type": "text", "text": SYSTEM_PROMPT, "cache_control": {"type": "ephemeral"}}],
        messages=messages,
        output_config={"format": {"type": "json_schema", "schema": ASSESSMENT_SCHEMA}},
    )
    extras = ai_config.request_extras(model_id)
    if extras:
        resp = cl.beta.messages.create(**params, **extras)
    else:
        resp = cl.messages.create(**params)
    ai_config.log_usage(resp, f"{PROMPT_VERSION}:평가표초안")

    if resp.stop_reason == "refusal":
        cat = getattr(getattr(resp, "stop_details", None), "category", None)
        raise DraftError(f"모델이 요청을 거절했습니다 (분류: {cat})")
    if resp.stop_reason == "max_tokens":
        raise DraftError(f"출력이 max_tokens({MAX_TOKENS})에서 잘렸습니다. 작업을 나눠서 입력하세요")
    text = next((b.text for b in resp.content if b.type == "text"), "")
    try:
        return json.loads(text), resp
    except json.JSONDecodeError as e:
        raise DraftError(f"JSON 해석 실패: {e}") from e


def draft(description: str, max_repairs: int = 1, cl=None) -> dict:
    """작업 설명 → {'평가표', '검사', '시도', '모델', '금액USD'}.

    검사 오류가 있으면 오류 목록을 보내 최대 max_repairs번 고쳐 쓰게 한다.
    """
    if not description.strip():
        raise ValueError("작업 설명이 비어 있습니다")
    cl = cl or ai_config.client()
    model_id = ai_config.model()
    messages = [{"role": "user", "content": _user_message(description)}]
    cost = 0.0
    for attempt in range(1, max_repairs + 2):
        assessment, resp = _call(cl, model_id, messages)
        cost += ai_config.cost_usd(resp.model, resp.usage)
        rep = validate(assessment)
        if rep.ok or attempt > max_repairs:
            break
        messages += [
            {"role": "assistant", "content": json.dumps(assessment, ensure_ascii=False)},
            {"role": "user", "content": _repair_message(rep)},
        ]
    return {"평가표": assessment, "검사": rep, "시도": attempt, "모델": resp.model, "금액USD": cost}


def save(result: dict, description: str) -> str:
    DRAFTS_DIR.mkdir(parents=True, exist_ok=True)
    path = DRAFTS_DIR / f"{datetime.now():%Y%m%d-%H%M%S}_{ai_config.mode()}.json"
    rep: Report = result["검사"]
    path.write_text(json.dumps({
        "프롬프트버전": PROMPT_VERSION, "모델": result["모델"], "시도": result["시도"],
        "금액USD": round(result["금액USD"], 6), "작업설명": description,
        "검사": {"통과": rep.ok, "오류": rep.errors, "확인필요": rep.warnings},
        "평가표": result["평가표"],
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    return str(path.relative_to(ai_config.ROOT))


def print_result(result: dict) -> None:
    a, rep = result["평가표"], result["검사"]
    from src.schema import risk_level
    print(f"\n■ {a.get('작업명', '')}  ({len(a.get('항목', []))}개 항목, 모델 {result['모델']}, 시도 {result['시도']}회)")
    for n, it in enumerate(a.get("항목", []), 1):
        before = risk_level(it["가능성"], it["중대성"])
        after = risk_level(it["개선후가능성"], it["개선후중대성"])
        print(f"{n:2}. [{it['분류']}] {it['세부작업']} — {it['유해위험요인']}")
        print(f"    위험성 {before}({it['가능성']}x{it['중대성']}) → {after}({it['개선후가능성']}x{it['개선후중대성']})"
              f"  근거: {it['관련근거'] or '-'}")
        for m in it["감소대책"]:
            print(f"    · {m}")
    print("\n검사:", "통과" if rep.ok else "불통과")
    for e in rep.errors:
        print("  오류:", e)
    for w in rep.warnings:
        print("  확인 필요:", w)


def ping() -> None:
    cl = ai_config.client()
    model_id = ai_config.model()
    resp = cl.messages.create(model=model_id, max_tokens=50,
                              messages=[{"role": "user", "content": "'연결 성공'이라고만 답하세요."}])
    ai_config.log_usage(resp, "ping")
    text = next((b.text for b in resp.content if b.type == "text"), "")
    print(f"[{resp.model}] {text.strip()}  (요청 ID {resp._request_id})")


def main() -> None:
    p = argparse.ArgumentParser(description="AI ① 위험성평가표 초안")
    p.add_argument("description", nargs="?", help="작업 설명")
    p.add_argument("--example", action="store_true", help="예시 작업 설명 사용")
    p.add_argument("--ping", action="store_true", help="API 연결만 확인")
    p.add_argument("--no-repair", action="store_true", help="검사 오류가 있어도 다시 쓰게 하지 않음")
    args = p.parse_args()

    if args.ping:
        ping()
    else:
        desc = EXAMPLE if args.example else (args.description or sys.stdin.read())
        try:
            result = draft(desc, max_repairs=0 if args.no_repair else 1)
        except DraftError as e:
            raise SystemExit(f"실패: {e}")
        print_result(result)
        print(f"\n저장: {save(result, desc)}  (이번 호출 ${result['금액USD']:.4f})")
    print(ai_config.spend_summary())


if __name__ == "__main__":
    main()
