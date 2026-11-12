# 소규모 공장 위험성평가 AI 도우미

안전 담당자가 없는 50인 미만 제조 현장의 반장·사업주가 작업 내용을 말로 설명하면, AI가 **위험성평가표**(유해·위험요인, 위험성, 감소대책, 관련 법 조항)를 작성하고 코드가 그 결과를 다시 검사하는 도구입니다. 완성된 평가표는 외국인 근로자용 다국어 요약으로도 바꿀 수 있습니다.

## 왜 필요한가
- 산재 사망의 약 80%가 50인 미만 사업장에서 발생 (뉴시스, 2025-08-01)
- 50인 미만 기업의 위험성평가 실시율 69.9%, 미실시 이유는 전문인력 부족 (경총 조사)
- 50인 미만 중소기업 80%가 중대재해처벌법 대응 준비 안 됨 (중기중앙회, 2023-12)

## 원칙: AI가 쓰고, 코드가 검증한다
AI가 쓴 평가표는 `src/validator.py`를 통과해야 합니다. 빈 항목, 분류 오류, 위험도가 높은데 대책 없음, 대책 후 위험도가 오히려 오름, 근거 없는 법 조항 등을 잡습니다.

## 데이터
- **한국가스공사 위험성평가 표준모델** (공공데이터포털 15156225, 이용허락범위 제한 없음): KRAS 양식 엑셀 80개 → `data/standard_models.csv` (유해·위험요인 3,712행, 작업 61종, 법 조항 148종)
- AI 평가표의 품질을 잴 때 정답지로 씁니다 (같은 작업의 표준모델 위험요인을 AI가 얼마나 찾아내는지).

## 구조
```
scripts/download_data.py   공공데이터포털에서 표준모델 내려받기 → data/raw/ (GitHub 제외)
src/build_dataset.py       엑셀 80개 → data/standard_models.csv
src/schema.py              평가표 형식(JSON 스키마), KRAS 6분류, 3x3 위험성 등급, 법 조항 추출
src/validator.py           평가표 검사기
src/ai_config.py           Claude 모델 선택(AI_MODE), API 키, 사용 금액 기록
```

## 실행
```bash
pip install -r requirements.txt
python scripts/download_data.py
python -m src.build_dataset
python -m src.validator          # 검사기 동작 확인
```
Claude API 키: `cp .streamlit/secrets.toml.example .streamlit/secrets.toml` 후 키 입력 (GitHub에 올라가지 않음)

## 위험성 판단 방법
「사업장 위험성평가에 관한 지침」(고용노동부 고시 제2023-19호)이 허용하는 방법 중 소규모 사업장이 쓰기 쉬운 3x3 빈도·강도법을 씁니다. 가능성(1~3) x 중대성(1~3) → 1~2 낮음, 3~4 보통, 6~9 높음.
