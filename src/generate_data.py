"""가상 데이터 생성: 4개 조 x 12명 = 48명 + 기본 근무표.

실행: python -m src.generate_data
  → data/employees.csv       인원 (사번, 조, 이름, 숙련도, 연차신청일, 최근야간근무일수)
  → data/base_schedule.csv   날짜 x 조 기본 근무표
"""

import random
from datetime import date, timedelta
from pathlib import Path

import pandas as pd

from src.rules import MIN_SKILLED_PER_SHIFT, MONTH, TEAM_SIZE, TEAMS, YEAR
from src.schedule import base_schedule, month_days, recent_nights, team_shift

SEED = 42
MAX_LEAVE_PER_TEAM_DAY = 3  # 같은 조 같은 날 연차는 최대 3명

SURNAMES = list("김이박최정강조윤장임한오서신권황안송류홍")
GIVEN_SYLLABLES = list("민서지현우준수영진호성은하윤도재경태연유승희동")

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
EMPLOYEES_PATH = DATA_DIR / "employees.csv"
SCHEDULE_PATH = DATA_DIR / "base_schedule.csv"


def make_names(n: int, rng: random.Random) -> list[str]:
    names: set[str] = set()
    while len(names) < n:
        names.add(rng.choice(SURNAMES) + "".join(rng.sample(GIVEN_SYLLABLES, 2)))
    return rng.sample(sorted(names), n)


def make_skills(rng: random.Random) -> list[int]:
    """조 하나의 숙련도. 근무마다 숙련자 3명이 필요하니 5~6명을 둬서 2~3명이 빠져도 버티게 한다."""
    skilled = rng.randint(MIN_SKILLED_PER_SHIFT + 2, MIN_SKILLED_PER_SHIFT + 3)
    middle = rng.randint(3, 4)
    skills = [3] * skilled + [2] * middle + [1] * (TEAM_SIZE - skilled - middle)
    rng.shuffle(skills)
    return skills


def make_leaves(team: int, rng: random.Random, team_day_count: dict) -> list[date]:
    """한 사람의 연차 신청일. 근무일에만 신청하고, 연말(24·25·31일)에 몰리게 한다."""
    workdays = [d for d in month_days() if team_shift(team, d) != "OFF"]
    weights = [3 if d.day in (24, 25, 31) else 1 for d in workdays]
    k = rng.choices([0, 1, 2, 3], weights=[30, 35, 25, 10])[0]
    picked: set[date] = set()
    for _ in range(50):
        if len(picked) >= k:
            break
        d = rng.choices(workdays, weights=weights)[0]
        if d in picked or team_day_count.get(d, 0) >= MAX_LEAVE_PER_TEAM_DAY:
            continue
        picked.add(d)
        team_day_count[d] = team_day_count.get(d, 0) + 1
    return sorted(picked)


def generate(seed: int = SEED) -> pd.DataFrame:
    rng = random.Random(seed)
    names = make_names(len(TEAMS) * TEAM_SIZE, rng)
    first_day = date(YEAR, MONTH, 1)
    rows = []
    for t in TEAMS:
        skills = make_skills(rng)
        team_day_count: dict[date, int] = {}
        base_nights = recent_nights(t, first_day)  # 패턴상 최근 14일 야간 일수
        for i in range(TEAM_SIZE):
            rows.append({
                "사번": f"E{t}{i + 1:02d}",
                "조": t,
                "이름": names.pop(),
                "숙련도": skills[i],
                "연차신청일": ";".join(d.isoformat() for d in make_leaves(t, rng, team_day_count)),
                # 패턴 야간 + 지난달 대체 투입으로 더 한 야간 0~2일
                "최근야간근무일수": base_nights + rng.choices([0, 1, 2], weights=[60, 30, 10])[0],
            })
    return pd.DataFrame(rows)


def load(path: Path = EMPLOYEES_PATH) -> pd.DataFrame:
    """CSV를 읽고 연차신청일을 date 리스트로 바꿔 돌려준다."""
    df = pd.read_csv(path, dtype={"연차신청일": str}).fillna({"연차신청일": ""})
    df["연차신청일"] = df["연차신청일"].apply(
        lambda s: [date.fromisoformat(x) for x in s.split(";") if x]
    )
    return df


if __name__ == "__main__":
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    df = generate()
    df.to_csv(EMPLOYEES_PATH, index=False, encoding="utf-8-sig")
    base_schedule().to_csv(SCHEDULE_PATH, encoding="utf-8-sig")
    print(f"{len(df)}명 → {EMPLOYEES_PATH.name}, 기본 근무표 → {SCHEDULE_PATH.name}")
    print(df.groupby("조")["숙련도"].value_counts().unstack(fill_value=0)
            .rename(columns={1: "초급", 2: "중급", 3: "숙련"}))
