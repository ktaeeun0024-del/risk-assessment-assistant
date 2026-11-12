"""Claude API 설정: 모델 선택, API 키 읽기, 사용 금액 기록.

모드는 환경 변수 AI_MODE로 고른다 (기본 dev).
  dev  : 개발·디버깅 (Haiku 5.5, 가장 저렴)
  eval : 포스터용 검증 시나리오 (Sonnet 5.5)
  demo : 시연 화면·배포 앱 (Sonnet 5.5)
예: AI_MODE=eval python -m src.ai_tools_demo
"""

import csv
import os
import tomllib
from datetime import datetime
from pathlib import Path

import anthropic

ROOT = Path(__file__).resolve().parent.parent
SECRETS_PATH = ROOT / ".streamlit" / "secrets.toml"
USAGE_LOG = ROOT / "logs" / "api_usage.csv"

MODELS = {
    "dev": "claude-haiku-5-5",
    "eval": "claude-sonnet-5-5",
    "demo": "claude-sonnet-5-5",
}

# 100만 토큰당 달러 (입력, 출력). 2026-11 기준. 캐시 할인은 계산하지 않아 실제보다 약간 높게 나온다.
PRICES = {
    "claude-haiku-5-5": (0.10, 0.50),
    "claude-sonnet-5-5": (2.00, 10.00),
    "claude-opus-5-5": (4.00, 20.00),
}

BUDGET_USD = 5.0  # 무료 크레딧 기준 예산. 넘으면 경고만 한다 (실제 차단은 Console 지출 한도로)


def mode() -> str:
    m = os.environ.get("AI_MODE", "dev")
    if m not in MODELS:
        raise ValueError(f"AI_MODE는 {list(MODELS)} 중 하나여야 합니다: {m}")
    return m


def model() -> str:
    return MODELS[mode()]


def request_extras(model_id: str) -> dict:
    """모델별 추가 요청 옵션.

    Sonnet·Opus 5.5는 안전 분류기가 요청을 거절하면(refusal) 서버가 다른 모델로
    다시 시도하게 한다(fallbacks). Haiku에는 이 기능이 없다.
    """
    if model_id in ("claude-sonnet-5-5", "claude-opus-5-5"):
        return {"betas": ["server-side-fallback-2026-07-01"], "fallbacks": "default"}
    return {}


def api_key() -> str | None:
    """환경 변수 ANTHROPIC_API_KEY, 없으면 .streamlit/secrets.toml에서 읽는다."""
    key = os.environ.get("ANTHROPIC_API_KEY")
    if key:
        return key
    if SECRETS_PATH.exists():
        with open(SECRETS_PATH, "rb") as f:
            return tomllib.load(f).get("ANTHROPIC_API_KEY")
    return None


def client() -> anthropic.Anthropic:
    key = api_key()
    if not key:
        raise SystemExit(
            "API 키가 없습니다. .streamlit/secrets.toml.example을 복사해 "
            ".streamlit/secrets.toml을 만들고 키를 넣으세요."
        )
    return anthropic.Anthropic(api_key=key)


def cost_usd(model_id: str, usage) -> float:
    p_in, p_out = PRICES.get(model_id, PRICES["claude-opus-5-5"])
    tokens_in = (usage.input_tokens or 0) + (getattr(usage, "cache_creation_input_tokens", 0) or 0) \
        + (getattr(usage, "cache_read_input_tokens", 0) or 0)
    return tokens_in / 1e6 * p_in + (usage.output_tokens or 0) / 1e6 * p_out


def log_usage(response, purpose: str) -> float:
    """응답 하나의 토큰과 금액을 logs/api_usage.csv에 남기고 금액을 돌려준다."""
    c = cost_usd(response.model, response.usage)
    USAGE_LOG.parent.mkdir(exist_ok=True)
    new = not USAGE_LOG.exists()
    with open(USAGE_LOG, "a", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        if new:
            w.writerow(["시각", "모드", "모델", "용도", "입력토큰", "출력토큰", "금액USD"])
        w.writerow([datetime.now().isoformat(timespec="seconds"), mode(), response.model, purpose,
                    response.usage.input_tokens, response.usage.output_tokens, f"{c:.6f}"])
    return c


def total_spent() -> float:
    if not USAGE_LOG.exists():
        return 0.0
    with open(USAGE_LOG, encoding="utf-8") as f:
        return sum(float(r["금액USD"]) for r in csv.DictReader(f))


def spend_summary() -> str:
    spent = total_spent()
    msg = f"누적 사용: ${spent:.4f} / 예산 ${BUDGET_USD:.2f} (약 {spent * 1400:,.0f}원)"
    if spent > BUDGET_USD * 0.8:
        msg += "  ⚠️ 예산의 80%를 넘었습니다"
    return msg
