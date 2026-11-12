# 교대근무 편성 도구 (Shift Scheduler)

생산직 4개 조(조당 12명, 총 48명)의 한 달 근무표를 자동으로 편성하는 도구입니다.

## 주요 기능
- **근무표 자동 생성**: Google OR-Tools(CP-SAT)로 근무 규칙을 제약 조건으로 넣어 근무표를 만듭니다.
- **피로 점수**: 연속 야간 근무 일수와 휴식 간격으로 점수를 계산하고, 위험군은 빨간색으로 표시합니다.
- **AI 대체 인원 추천**: "2조 김OO 25일 병가"처럼 입력하면 Claude API가 대체 인원 후보와 선정 이유를 알려 줍니다.
- **결원 시뮬레이션**: 하루 결원이 2명 생겼을 때 라인 인원이 어떻게 비는지 비교합니다.

## 구조
```
data/    가상 인원 데이터 (이름, 숙련도, 연차 신청일, 최근 야간 근무 일수)
src/     데이터 생성, 규칙, 스케줄러, 피로 점수, AI 추천
pages/   Streamlit 페이지
app.py   Streamlit 진입점
```

## 실행
```bash
pip install -r requirements.txt
streamlit run app.py
```

Claude API 키는 `.streamlit/secrets.toml` 또는 환경 변수 `ANTHROPIC_API_KEY`로 설정합니다.
