"""근무 편성 규칙 (4조 3교대, 조 단위 순환).

기본 근무표는 순환 패턴으로 정해지고, 규칙은 연차·병가로 생긴 결원을
누구로 어떻게 메울지 판단할 때 쓴다. 숫자만 바꾸면 검사기와 스케줄러에 그대로 반영된다.
"""

from dataclasses import dataclass
from datetime import date

# 근무 형태와 시각 (야간은 당일 22시 ~ 다음 날 06시)
SHIFTS = ["D", "E", "N", "OFF"]
WORK_SHIFTS = ["D", "E", "N"]
SHIFT_NAMES = {"D": "주간", "E": "오후", "N": "야간", "OFF": "휴무"}
SHIFT_HOURS = {"D": (6, 14), "E": (14, 22), "N": (22, 30)}  # 30 = 다음 날 06시

# 순환 패턴: 주주 오오 야야 휴휴 (8일 주기, 정방향 순환)
PATTERN = ["D", "D", "E", "E", "N", "N", "OFF", "OFF"]
ANCHOR = date(2026, 12, 1)  # 이 날 1조가 패턴의 첫날(주간 1일차)
TEAMS = [1, 2, 3, 4]
TEAM_OFFSET = {t: -2 * (t - 1) for t in TEAMS}  # 조마다 2일씩 어긋나게

# 숙련도
SKILL_NAMES = {1: "초급", 2: "중급", 3: "숙련"}
SKILLED_LEVEL = 3

# 편성 대상 기간
YEAR, MONTH = 2026, 12

# 규칙 파라미터
TEAM_SIZE = 12
MIN_STAFF_PER_SHIFT = 11         # 근무마다 최소 인원
MIN_SKILLED_PER_SHIFT = 3        # 근무마다 숙련자 최소 인원
MIN_REST_HOURS = 11              # 근무와 근무 사이 최소 휴식
MAX_CONSECUTIVE_NIGHTS = 3       # 야간 연속 최대 일수
MAX_CONSECUTIVE_WORK_DAYS = 7    # 연속 근무 최대 일수 (기본 패턴은 6일)
MAX_HOURS_PER_DAY = 12           # 연장 포함 한 번에 일하는 최대 시간
MAX_EXTRA_PER_MONTH = 3          # 1인 월 추가 투입(특근 + 연장) 최대 횟수
EXTENSION_HOURS = 4              # 연장 근무 한 번의 길이

# 권장 규칙 벌점 (낮을수록 먼저 고른다. 피로 점수에 더해진다)
EXTENSION_PENALTY = 10           # 앞뒤 연장: 두 명이 12시간씩 일하게 되므로 특근보다 뒤로
LEAVE_ADJACENT_PENALTY = 30      # 연차 전날·다음 날 특근: 다른 방법이 모두 없을 때만


@dataclass
class Rule:
    key: str
    description: str
    kind: str  # "필수"(hard) 또는 "권장"(soft)
    enabled: bool = True


RULES = [
    Rule("min_staff", f"근무마다 {TEAM_SIZE}명 중 {MIN_STAFF_PER_SHIFT}명 이상이 일해야 한다", "필수"),
    Rule("min_skilled", f"근무마다 숙련자가 {MIN_SKILLED_PER_SHIFT}명 이상 있어야 한다", "필수"),
    Rule("leave", "연차·병가를 낸 사람은 그날 투입하지 않는다", "필수"),
    Rule("min_rest", f"근무와 근무 사이에 {MIN_REST_HOURS}시간 이상 쉰다 "
                     "(야간 다음 날 주간·오후 금지, 오후 다음 날 주간 금지)", "필수"),
    Rule("max_consecutive_nights", f"야간은 연속 {MAX_CONSECUTIVE_NIGHTS}일까지만 한다", "필수"),
    Rule("max_consecutive_work", f"연속 근무는 {MAX_CONSECUTIVE_WORK_DAYS}일까지만 한다", "필수"),
    Rule("max_hours", f"연장을 포함해 한 번에 {MAX_HOURS_PER_DAY}시간을 넘게 일하지 않는다", "필수"),
    Rule("max_extra", f"한 사람의 추가 투입(특근 + 연장)은 한 달 {MAX_EXTRA_PER_MONTH}회까지다", "필수"),
    Rule("low_fatigue", "피로 점수(최근 야간 일수, 이번 달 추가 투입 횟수)가 낮은 사람을 먼저 고른다", "권장"),
    Rule("same_skill", "빠진 사람과 숙련도가 같거나 높은 사람을 먼저 고른다", "권장"),
    Rule("avoid_leave_adjacent", "연차 전날·다음 날에는 특근을 피한다. 다른 방법이 없을 때만 쓰고, "
                                 "쓸 때는 연차가 취소되면 다시 검토해야 한다고 알린다", "권장"),
]

FILL_METHODS = [
    ("휴무조 특근", "그날 쉬는 조에서 한 명이 8시간 근무를 대신한다"),
    ("앞뒤 연장", f"앞 근무조 한 명이 {EXTENSION_HOURS}시간 더 남고, 뒤 근무조 한 명이 "
                f"{EXTENSION_HOURS}시간 일찍 나온다 (두 명이 한 자리를 나눠 메움)"),
]


def rules_markdown() -> str:
    """노션 등에 붙여 넣을 규칙 목록."""
    lines = [f"# 근무 편성 규칙 ({YEAR}년 {MONTH}월, 4조 3교대)", "",
             "근무 시각: 주간 06–14시, 오후 14–22시, 야간 22–06시",
             "순환 패턴: " + " ".join(SHIFT_NAMES[s] for s in PATTERN) + " (8일 주기)", ""]
    for kind in ("필수", "권장"):
        lines.append(f"## {kind} 규칙")
        for i, r in enumerate([r for r in RULES if r.kind == kind and r.enabled], 1):
            lines.append(f"{i}. {r.description}")
        lines.append("")
    lines.append("## 결원을 메우는 방법")
    for name, desc in FILL_METHODS:
        lines.append(f"- {name}: {desc}")
    return "\n".join(lines)


if __name__ == "__main__":
    print(rules_markdown())
