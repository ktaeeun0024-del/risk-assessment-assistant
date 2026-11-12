"""기본 근무표: 4개 조가 순환 패턴을 2일씩 어긋나게 돈다."""

import calendar
from datetime import date, timedelta

import pandas as pd

from src.rules import ANCHOR, MONTH, PATTERN, TEAM_OFFSET, TEAMS, YEAR


def team_shift(team: int, day: date) -> str:
    """해당 날짜에 그 조가 하는 근무. 이전 달·다음 달 날짜도 계산된다."""
    idx = ((day - ANCHOR).days + TEAM_OFFSET[team]) % len(PATTERN)
    return PATTERN[idx]


def month_days(year: int = YEAR, month: int = MONTH) -> list[date]:
    n = calendar.monthrange(year, month)[1]
    return [date(year, month, d) for d in range(1, n + 1)]


def base_schedule(year: int = YEAR, month: int = MONTH) -> pd.DataFrame:
    """날짜 x 조 근무표 (행: 날짜, 열: 조)."""
    days = month_days(year, month)
    return pd.DataFrame({t: [team_shift(t, d) for d in days] for t in TEAMS},
                        index=pd.Index(days, name="날짜"))


def recent_nights(team: int, before: date, days: int = 14) -> int:
    """before 직전 days일 동안 패턴상 야간 일수."""
    return sum(team_shift(team, before - timedelta(k)) == "N" for k in range(1, days + 1))


if __name__ == "__main__":
    df = base_schedule()
    print(df.head(10).to_string())
    for d, row in df.iterrows():  # 매일 주간·오후·야간을 정확히 한 조씩 맡는지 확인
        assert sorted(row) == ["D", "E", "N", "OFF"], d
    print("매일 주간·오후·야간·휴무를 한 조씩 맡음: OK")
