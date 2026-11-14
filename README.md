# 위험성평가 도우미

안전 담당자가 없는 50인 미만 제조 현장의 반장·사업주가 작업 내용을 말로 설명하면, AI가 **위험성평가표 초안**(유해·위험요인, 위험성, 감소대책, 관련 법 조항)을 쓰고 코드가 그 결과를 다시 검사하는 웹 앱입니다. (Next.js + TypeScript)

## 왜 필요한가
- 산재 사망의 약 80%가 50인 미만 사업장에서 발생 (뉴시스, 2025-08-01)
- 50인 미만 기업의 위험성평가 실시율 69.9%, 미실시 이유는 전문인력 부족 (경총 조사)
- 50인 미만 중소기업 80%가 중대재해처벌법 대응 준비 안 됨 (중기중앙회, 2023-12)

## 주요 기능
- 작업 설명(10~1,500자)을 적고 '평가표 만들기'를 누르면 KRAS 양식 위험성평가표가 나옵니다. '예시 넣기'로 프레스 공장 예시를 넣어 볼 수 있습니다.
- 만드는 방식은 두 가지입니다.
  - **AI 초안**: OpenRouter 무료 모델(`openrouter/free`)이 씁니다. 공공 표준모델에서 비슷한 작업을 찾은 결과를 참고 자료로 함께 줍니다. 30초~1분 넘게 걸릴 수 있습니다.
  - **표준모델 검색 (AI 없이)**: 작업 설명을 구절로 나눠 표준모델에서 비슷한 위험요인을 찾아 바로 만듭니다. 가능성·중대성은 규칙으로 정한 기본값입니다.
- **AI가 쓰고 코드가 검증합니다.** 모든 평가표는 검사기(`lib/validator.ts`)를 거칩니다. 빈 칸, KRAS 6분류가 아닌 분류, 위험성이 보통 이상인데 감소대책 없음, 대책 후 위험성이 오히려 높음은 '오류'로, 대책 후에도 높음, 표준모델에 없는 법 조항 인용 등은 '확인 필요'로 보여 줍니다.
- AI 답이 JSON 형식에 맞지 않으면 한 번 다시 요청하고, 검사 오류가 있으면 오류 목록을 보내 한 번 고쳐 쓰게 합니다.
- AI가 실패하면(키 없음, 요청 한도, 시간 초과 등) 표준모델 검색 초안을 대신 보여 주고 이유를 안내합니다.
- 위험성은 낮음·보통·높음 색으로 표시하고, CSV(엑셀용)로 내려받을 수 있습니다.
- 만든 평가표를 PostgreSQL에 저장하고, 아래에 최근 5개를 보여 줍니다. '다시 보기'로 다시 열 수 있습니다. 테이블(`assessment_history`)은 처음 쓸 때 자동으로 만들어집니다. DB에 연결하지 못해도 평가표 만들기는 그대로 동작합니다.
- API: `POST /api/assess` — `{ "description": "...", "mode": "ai" | "search" }` → `{ assessment, report, mode, model, attempts, sources?, fallback?, notice? }`. `GET /api/history`는 최근 기록 5개를 돌려줍니다.

## 실행 방법
Node.js 20 이상과 PostgreSQL이 필요합니다.

```bash
npm install
cp .env.sample .env   # .env에 키 값을 채워 넣기
npm run dev           # 개발 서버
# 또는
npm run build && npm start
```

포트는 환경변수 `PORT`를 사용합니다. 지정하지 않으면 3000입니다.

## 필요한 키
`.env`에 넣습니다. `.env`와 `.env.local`은 git에 올라가지 않습니다.

| 이름 | 설명 |
| --- | --- |
| `OPENROUTER_API_KEY` | OpenRouter API 키 (https://openrouter.ai/settings/keys 에서 발급). 없으면 표준모델 검색 초안만 나옵니다 |
| `DATABASE_URL` | PostgreSQL 접속 주소 (예: `postgresql://사용자:비밀번호@호스트:5432/DB이름`) |
| `OPENROUTER_MODEL` | (선택) 비워 두면 `openrouter/free`. 검증 측정처럼 결과를 비교할 때 무료 모델 하나를 이름으로 고정 |

## 데이터
- **한국가스공사 위험성평가 표준모델** (공공데이터포털 15156225, 이용허락범위 제한 없음): KRAS 양식 엑셀 80개 → `data/standard_models.csv` (유해·위험요인 3,712행, 작업 61종, 법 조항 148종) → 웹 앱용 `data/standard_models.json` (분류가 정리된 3,630행)
- 데이터는 파이썬으로 만듭니다 (웹 앱 실행에는 필요 없음):

```bash
python -m venv .venv && .venv/bin/pip install -r requirements.txt
python scripts/download_data.py          # 공공데이터포털에서 내려받기 → data/raw/ (git 제외)
python -m src.build_dataset              # 엑셀 80개 → CSV + JSON
python -m src.build_dataset --json-only  # CSV에서 JSON만 다시 만들기
```

## 구조
```
app/page.tsx              화면: 입력 → 평가표(위험도 색) → 검사 결과 → CSV, 최근 기록
app/api/assess/route.ts   평가표 만들기 (AI 또는 표준모델 검색, 실패 시 검색 초안으로 대신)
app/api/history/route.ts  최근 기록 5개
lib/schema.ts             평가표 형식, KRAS 6분류, 3x3 위험성 등급, 법 조항 추출
lib/validator.ts          평가표 검사기
lib/retrieve.ts           표준모델 검색 초안 (BM25, src/retrieve_draft.py와 같은 결과)
lib/ai.ts                 OpenRouter 무료 모델 호출, JSON 파싱, 검사 오류 수정 요청
lib/db.ts                 PostgreSQL 저장·조회
src/, scripts/            파이썬 데이터 처리 (표준모델 내려받기·정리, 검사기·검색 원본)
src/draft.py              (실험) Claude API로 만드는 초안. 웹 앱에서는 쓰지 않음
```

## 위험성 판단 방법
「사업장 위험성평가에 관한 지침」(고용노동부 고시 제2023-19호)이 허용하는 방법 중 소규모 사업장이 쓰기 쉬운 3x3 빈도·강도법을 씁니다. 가능성(1~3) × 중대성(1~3) → 1~2 낮음, 3~4 보통, 6~9 높음.

## 한계
- 초안 도구입니다. 법률 자문이 아니며, 위험성평가의 최종 판단과 책임은 사업주에게 있습니다.
- 표준모델이 가스공사 작업(지게차·크레인·배관·설비 점검 등) 위주라 프레스·사출 같은 일반 제조 공정은 적습니다.
- 무료 모델은 요청마다 다른 모델이 답할 수 있어 품질과 속도가 들쭉날쭉합니다.
