# 교대근무 결원 대응 도구 (Shift Scheduler)

반도체 공장처럼 24시간 돌아가는 생산 현장의 **4조 3교대** 근무표에서 연차·병가로 결원이 생겼을 때, 규칙을 지키면서 누구로 메울지 찾아 주는 도구입니다.

## 근무 방식
- 4개 조(조당 12명, 총 48명)가 `주주 오오 야야 휴휴` 8일 주기를 2일씩 어긋나게 돕니다. 매일 3개 조가 일하고 1개 조가 쉽니다.
- 근무 시각: 주간 06–14시, 오후 14–22시, 야간 22–06시
- 결원을 메우는 방법: **휴무조 특근**(쉬는 조 1명이 8시간 대신 근무) 또는 **앞뒤 연장**(앞뒤 근무조가 4시간씩 나눠 메움)

## 주요 기능
- **규칙 검사기**: 휴식 11시간, 야간 연속 3일, 연속 근무 7일 등 필수 규칙을 검사합니다. AI나 OR-Tools가 추천한 대체 인원도 이 검사를 통과해야 반영됩니다.
- **대체 인원 최적화**: Google OR-Tools로 한 달 결원 전체를 규칙 안에서 공평하게 메웁니다.
- **피로 점수**: 최근 야간 일수와 추가 투입 횟수로 계산하고, 위험군은 빨간색으로 표시합니다.
- **AI 결원 대응**: "2조 김OO 25일 병가"처럼 입력하면 Claude API가 대체 인원 후보와 고른 이유를 설명합니다.

## 구조
```
data/employees.csv       가상 인원 48명 (사번, 조, 이름, 숙련도, 연차신청일, 최근야간근무일수)
data/base_schedule.csv   2026년 12월 기본 근무표 (날짜 x 조)
src/rules.py             규칙과 파라미터 (숫자만 바꾸면 전체에 반영)
src/schedule.py          순환 패턴으로 기본 근무표 생성
src/generate_data.py     가상 데이터 생성 (seed 42)
src/checker.py           결원 찾기와 규칙 검사기
app.py                   Streamlit 진입점
```

## 실행
```bash
pip install -r requirements.txt
python -m src.generate_data   # 데이터 생성
python -m src.checker         # 12월 결원과 메울 수 있는지 확인
streamlit run app.py
```

Claude API 키는 `.streamlit/secrets.toml` 또는 환경 변수 `ANTHROPIC_API_KEY`로 설정합니다.
