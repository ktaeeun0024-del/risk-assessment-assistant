"""규칙 검사기: 결원 찾기, 대체 투입이 규칙을 지키는지 검사.

AI(Claude)나 OR-Tools가 추천한 대체 인원도 이 검사기를 통과해야 근무표에 반영한다.
실행: python -m src.checker  → 12월 결원과 규칙 안에서 메울 수 있는지 요약
"""

from dataclasses import dataclass, field
from datetime import date, timedelta

import pandas as pd

from src import rules as R
from src.schedule import month_days, team_shift

PREV_SHIFT = {"D": ("N", -1), "E": ("D", 0), "N": ("E", 0)}  # 바로 앞 근무 (근무, 날짜 차이)
NEXT_SHIFT = {"D": ("E", 0), "E": ("N", 0), "N": ("D", 1)}   # 바로 뒤 근무


@dataclass
class Shortage:
    day: date
    team: int
    shift: str
    absent: list[str]        # 빠진 사번
    staff_short: int         # 부족 인원
    skilled_short: int       # 부족 숙련자


@dataclass
class Extra:
    """대체 투입 한 건. kind: 특근 / 연장(앞) / 연장(뒤)"""
    emp: str
    day: date
    shift: str
    kind: str


@dataclass
class State:
    employees: pd.DataFrame
    extras: list[Extra] = field(default_factory=list)

    def __post_init__(self):
        self.by_id = self.employees.set_index("사번")
        self.leave = {r.사번: set(r.연차신청일) for r in self.employees.itertuples()}

    def on_leave(self, emp: str, day: date) -> bool:
        return day in self.leave[emp]


def _abs_hours(day: date, hour: int) -> int:
    return (day - R.ANCHOR).days * 24 + hour


def _intervals(state: State, emp: str, around: date, extra: Extra | None) -> list[tuple]:
    """emp의 근무 구간(시작, 끝, 시작 날짜, 야간 여부)을 around 앞뒤 10일 범위로 만든다."""
    team = int(state.by_id.loc[emp, "조"])
    extras = [e for e in state.extras if e.emp == emp] + ([extra] if extra else [])
    iv = []
    for k in range(-10, 11):
        d = around + timedelta(k)
        s = team_shift(team, d)
        if s == "OFF" or state.on_leave(emp, d):
            continue
        a, b = R.SHIFT_HOURS[s]
        for e in extras:  # 연장은 자기 근무 구간을 늘린다
            if e.kind == "연장(앞)" and _ext_target(e) == (d, s):
                b += R.EXTENSION_HOURS
            if e.kind == "연장(뒤)" and _ext_target(e) == (d, s):
                a -= R.EXTENSION_HOURS
        iv.append((_abs_hours(d, a), _abs_hours(d, b), d, s == "N"))
    for e in extras:
        if e.kind == "특근":
            a, b = R.SHIFT_HOURS[e.shift]
            iv.append((_abs_hours(e.day, a), _abs_hours(e.day, b), e.day, e.shift == "N"))
    return sorted(iv)


def _ext_target(e: Extra) -> tuple[date, str]:
    """연장이 붙는 자기 근무 (날짜, 근무)."""
    if e.kind == "연장(앞)":
        s, dd = PREV_SHIFT[e.shift]
    else:
        s, dd = NEXT_SHIFT[e.shift]
    return e.day + timedelta(dd), s


def violations(state: State, extra: Extra) -> list[str]:
    """extra를 넣었을 때 어기는 필수 규칙 목록 (빈 리스트면 통과)."""
    emp, out = extra.emp, []
    team = int(state.by_id.loc[emp, "조"])
    if state.on_leave(emp, extra.day):
        out.append("연차·병가 중")
    if extra.kind == "특근" and team_shift(team, extra.day) != "OFF":
        out.append("그날 이미 근무 중인 조")
    if extra.kind != "특근":
        d, s = _ext_target(extra)
        if team_shift(team, d) != s or state.on_leave(emp, d):
            out.append("연장할 자기 근무가 없음")
    n_extra = sum(e.emp == emp and e.day.month == extra.day.month for e in state.extras)
    if n_extra + 1 > R.MAX_EXTRA_PER_MONTH:
        out.append(f"월 추가 투입 {R.MAX_EXTRA_PER_MONTH}회 초과")

    iv = _intervals(state, emp, extra.day, extra)
    # 붙어 있는 구간을 합쳐 한 번에 일하는 시간과 휴식 시간을 본다
    merged = [list(iv[0][:2])] if iv else []
    for a, b, *_ in iv[1:]:
        if a <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], b)
        else:
            merged.append([a, b])
    if any(b - a > R.MAX_HOURS_PER_DAY for a, b in merged):
        out.append(f"한 번에 {R.MAX_HOURS_PER_DAY}시간 초과")
    if any(m2[0] - m1[1] < R.MIN_REST_HOURS for m1, m2 in zip(merged, merged[1:])):
        out.append(f"휴식 {R.MIN_REST_HOURS}시간 미만")

    work_days = {d for *_, d, _ in iv}
    night_days = {d for *_, d, night in iv if night}
    if _max_run(night_days) > R.MAX_CONSECUTIVE_NIGHTS:
        out.append(f"야간 연속 {R.MAX_CONSECUTIVE_NIGHTS}일 초과")
    if _max_run(work_days) > R.MAX_CONSECUTIVE_WORK_DAYS:
        out.append(f"연속 근무 {R.MAX_CONSECUTIVE_WORK_DAYS}일 초과")
    return out


def _max_run(days: set[date]) -> int:
    best = 0
    for d in days:
        if d - timedelta(1) not in days:
            n = 1
            while d + timedelta(n) in days:
                n += 1
            best = max(best, n)
    return best


def find_shortages(state: State) -> list[Shortage]:
    out = []
    for d in month_days():
        for team in R.TEAMS:
            s = team_shift(team, d)
            if s == "OFF":
                continue
            members = state.employees[state.employees["조"] == team]
            absent = [r.사번 for r in members.itertuples() if state.on_leave(r.사번, d)]
            present = members[~members["사번"].isin(absent)]
            staff_short = max(0, R.MIN_STAFF_PER_SHIFT - len(present))
            skilled_short = max(0, R.MIN_SKILLED_PER_SHIFT - int((present["숙련도"] >= R.SKILLED_LEVEL).sum()))
            if staff_short or skilled_short:
                out.append(Shortage(d, team, s, absent, staff_short, skilled_short))
    return out


def fatigue(state: State, emp: str) -> int:
    """임시 피로 점수: 최근 야간 일수 + 이번 달 추가 투입 x 2 (11/15 이후 다듬는다)."""
    return int(state.by_id.loc[emp, "최근야간근무일수"]) + 2 * sum(e.emp == emp for e in state.extras)


def leave_adjacent(state: State, x: Extra) -> bool:
    """특근 날의 전날이나 다음 날이 그 사람의 연차인가 (권장 규칙 avoid_leave_adjacent)."""
    return x.kind == "특근" and bool({x.day - timedelta(1), x.day + timedelta(1)} & state.leave[x.emp])


def cost(state: State, option: list[Extra]) -> int:
    """방법 하나의 비용 = 피로 점수 합 + 권장 규칙 벌점. 낮을수록 먼저 고른다."""
    c = sum(fatigue(state, x.emp) for x in option)
    if len(option) == 2:
        c += R.EXTENSION_PENALTY
    if any(leave_adjacent(state, x) for x in option):
        c += R.LEAVE_ADJACENT_PENALTY
    return c


def options(state: State, sh: Shortage, need_skilled: bool) -> list[list[Extra]]:
    """결원 한 자리를 메울 수 있는 방법들 (특근 1명 또는 연장 2명), 비용 낮은 순."""
    def ok_people(team, cond):
        rows = state.employees[(state.employees["조"] == team)]
        if need_skilled:
            rows = rows[rows["숙련도"] >= R.SKILLED_LEVEL]
        return sorted([r for r in rows["사번"] if cond(r)], key=lambda e: fatigue(state, e))

    used = {e.emp for e in state.extras if e.day == sh.day}
    result = []
    off_team = next(t for t in R.TEAMS if team_shift(t, sh.day) == "OFF")
    for emp in ok_people(off_team, lambda e: e not in used):
        x = Extra(emp, sh.day, sh.shift, "특근")
        if not violations(state, x):
            result.append([x])
    ps, pd_ = PREV_SHIFT[sh.shift]
    ns, nd = NEXT_SHIFT[sh.shift]
    prev_team = next(t for t in R.TEAMS if team_shift(t, sh.day + timedelta(pd_)) == ps)
    next_team = next(t for t in R.TEAMS if team_shift(t, sh.day + timedelta(nd)) == ns)
    fronts = [Extra(e, sh.day, sh.shift, "연장(앞)") for e in ok_people(prev_team, lambda e: e not in used)]
    backs = [Extra(e, sh.day, sh.shift, "연장(뒤)") for e in ok_people(next_team, lambda e: e not in used)]
    fronts = [x for x in fronts if not violations(state, x)]
    backs = [x for x in backs if not violations(state, x)]
    if fronts and backs:
        result.append([fronts[0], backs[0]])
    return sorted(result, key=lambda o: cost(state, o))


def greedy_fill(state: State) -> dict:
    """앞에서부터 피로 낮은 사람으로 채워 보는 간단한 확인용 (최종은 OR-Tools)."""
    stats = {"결원 자리": 0, "휴무조 특근": 0, "앞뒤 연장": 0, "연차 앞뒤 특근": 0, "못 메움": 0}
    unfilled = []
    for sh in find_shortages(state):
        need = max(sh.staff_short, sh.skilled_short)
        for i in range(need):
            stats["결원 자리"] += 1
            opts = options(state, sh, need_skilled=i < sh.skilled_short)
            if not opts:
                stats["못 메움"] += 1
                unfilled.append(sh)
                continue
            pick = opts[0]
            state.extras.extend(pick)
            stats["휴무조 특근" if len(pick) == 1 else "앞뒤 연장"] += 1
            stats["연차 앞뒤 특근"] += any(leave_adjacent(state, x) for x in pick)
    return {"stats": stats, "unfilled": unfilled}


if __name__ == "__main__":
    from src.generate_data import load

    state = State(load())
    shortages = find_shortages(state)
    by_shift = pd.Series([R.SHIFT_NAMES[s.shift] for s in shortages]).value_counts().to_dict()
    print(f"결원 발생 근무: {len(shortages)}건 {by_shift}")
    for s in shortages[:5]:
        print(f"  {s.day} {s.team}조 {R.SHIFT_NAMES[s.shift]}: 인원 -{s.staff_short}, 숙련 -{s.skilled_short}")
    res = greedy_fill(state)
    print(res["stats"])
    for s in res["unfilled"]:
        print("  못 메움:", s.day, f"{s.team}조", R.SHIFT_NAMES[s.shift])
