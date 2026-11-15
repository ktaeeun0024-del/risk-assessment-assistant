# 위험성평가 도우미

안전 담당자가 없는 50인 미만 제조 현장의 반장·사업주가 작업 내용을 말로 설명하면, AI가 **위험성평가표 초안**(유해·위험요인, 위험성, 감소대책, 관련 법 조항)을 쓰고 코드가 그 결과를 다시 검사하는 웹 앱입니다. (Next.js + TypeScript)

## 왜 필요한가
- 산재 사망의 약 80%가 50인 미만 사업장에서 발생 (뉴시스, 2025-08-01)
- 50인 미만 기업의 위험성평가 실시율 69.9%, 미실시 이유는 전문인력 부족 (경총 조사)
- 50인 미만 중소기업 80%가 중대재해처벌법 대응 준비 안 됨 (중기중앙회, 2023-12)

## 주요 기능
- 작업 설명(10~1,500자)을 적고 '평가표 만들기'를 누르면 KRAS 양식 위험성평가표가 나옵니다. '예시 넣기'로 프레스 공장 예시를 넣어 볼 수 있습니다.
- 만드는 방식은 두 가지입니다.
  - **AI 초안**: OpenRouter 무료 모델(`nvidia/nemotron-3-ultra-550b-a55b:free`, [검증 측정](eval/README.md)으로 고름)이 씁니다. 공공 표준모델에서 비슷한 작업을 찾은 결과를 참고 자료로 함께 줍니다. 1~2분 걸립니다(검증 측정 평균 약 100초). 기다리는 동안 화면에 경과 시간이 나옵니다.
  - **표준모델 검색 (AI 없이)**: 작업 설명을 구절로 나눠 표준모델에서 비슷한 위험요인을 찾아 바로 만듭니다. 가능성·중대성은 규칙으로 정한 기본값입니다.
- **AI가 쓰고 코드가 검증합니다.** 모든 평가표는 검사기(`lib/validator.ts`)를 거칩니다. 빈 칸, KRAS 6분류가 아닌 분류, 위험성이 보통 이상인데 감소대책 없음, 대책 후 위험성이 오히려 높음은 '오류'로, 대책 후에도 높음, 표준모델에 없는 법 조항 인용 등은 '확인 필요'로 보여 줍니다.
- AI 답이 JSON 형식에 맞지 않으면 한 번 다시 요청하고, 검사 오류가 있으면 오류 목록을 보내 한 번 고쳐 쓰게 합니다.
- AI가 실패하면(키 없음, 요청 한도, 시간 초과 등) 표준모델 검색 초안을 대신 보여 주고 이유를 안내합니다.
- 위험성은 낮음·보통·높음 색으로 표시하고, CSV(엑셀용)로 내려받을 수 있습니다.
- **회사별 계정과 기록**
  - **회사 가입**: 회사 이름·사업자등록번호·이름·이메일·비밀번호를 넣으면 이메일로 6자리 인증번호가 갑니다. 인증하면 회사가 **승인 대기**로 만들어지고 가입한 사람이 회사 관리자가 됩니다. 사업자등록번호는 검증 숫자로 오타를 거르고, 국세청 사업자등록 상태(계속·휴업·폐업)를 조회해 함께 저장합니다.
  - **사이트 관리자 승인**: `SITE_ADMIN_EMAILS`의 이메일로 로그인하면 '가입 승인' 화면에서 신청 회사의 사업자등록번호·국세청 조회 결과·신청자를 보고 승인·거절합니다. 신청이 들어오면 사이트 관리자에게, 승인·거절하면 신청자에게 메일이 갑니다. 승인 전에는 로그인할 수 없습니다. 사이트 관리자 본인의 이메일로 가입하면 바로 승인됩니다.
  - **직원 초대**: 회사 관리자가 '직원 관리'에서 직원 이메일을 넣으면 초대 메일(인증번호, 24시간 유효)이 갑니다. 직원은 '초대받았어요'에서 인증번호를 넣고 자기 비밀번호를 정해 가입합니다. 관리자는 초대 다시 보내기·취소, 계정 삭제를 할 수 있습니다.
  - **비밀번호 찾기**: 로그인 화면의 '비밀번호를 잊었어요'에서 이메일 인증번호로 새 비밀번호를 정합니다(모든 기기 로그인 끊김). 가입 여부는 알려 주지 않습니다.
  - 인증번호는 DB에 해시로만 저장하고, 다시 보내기는 60초에 한 번·1시간에 5번, 5번 틀리면 그 번호는 못 씁니다.
  - 로그인하면 만든 평가표가 **우리 회사 기록**에 저장되고, 같은 회사 계정끼리만 볼 수 있습니다. 회사는 서버가 로그인 세션으로만 정합니다(요청에 회사 번호를 받지 않음).
  - 로그인 없이도 표준모델 검색 초안은 써 볼 수 있습니다. AI 초안과 기록 저장은 로그인한 계정만 쓸 수 있습니다(무료 AI 하루 사용량 보호).
- **보안**: 비밀번호는 scrypt로 암호화해 저장, 로그인 상태는 HttpOnly 쿠키(DB에는 토큰의 해시만 저장, 7일), 같은 이메일로 5번 틀리면 10분 잠금, 다른 사이트에서 온 요청(Origin 불일치) 거절. 모든 테이블에 RLS를 켜서 Supabase 공개 API로는 읽을 수 없게 했습니다.
- 테이블(`companies`, `users`, `sessions`, `assessment_history`, `email_codes`, `ai_jobs`)과 RLS 설정은 앱이 처음 DB를 쓸 때 자동으로 만들어집니다. DB에 연결하지 못해도 검색 초안 만들기는 동작하고 로그인 기능만 숨겨집니다.
- API
  - `POST /api/assess` — `{ "description": "...", "mode": "ai" | "search" }` → `{ assessment, report, mode, model, attempts, sources?, fallback?, notice?, saved? }`
    - 배포 사이트(`AI_JOB_URL` 있음)의 AI 모드는 `202 { pending: true, jobId }`를 바로 돌려줍니다.
  - `GET /api/assess?job=<jobId>` — AI 작업 결과 확인 (로그인 필요, 우리 회사 작업만). 작성 중이면 `202 { pending: true, jobId }`, 끝나면 위와 같은 평가표 (실패하면 검색 초안으로 대체)
  - `GET /api/history` — 우리 회사 기록 최근 20개 (로그인 필요)
  - `POST /api/auth/register` → `register/verify` (회사 가입), `invite` (초대 수락), `reset` → `reset/verify` (비밀번호 찾기), `login` · `logout` · `password`, `GET /api/auth/me`
  - `GET·POST /api/company/members` (직원 목록·초대), `POST /api/company/invites` (초대 다시 보내기·취소), `POST /api/company/members/remove` (회사 관리자)
  - `GET·POST /api/admin/companies` (가입 신청 목록·승인·거절·국세청 다시 조회, 사이트 관리자)

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
| `OPENROUTER_MODEL` | (선택) 비워 두면 `nvidia/nemotron-3-ultra-550b-a55b:free`. 다른 무료 모델로 바꿀 때만 넣음 (`openrouter/free`는 부를 때마다 모델이 바뀜) |
| `AI_JOB_URL` | (배포용) Supabase Edge Function 주소 `https://<프로젝트 ref>.supabase.co/functions/v1/ai-draft`. 넣으면 AI 초안을 Supabase에서 뒤에서 만들고 화면이 결과를 확인함. 비우면 그 자리에서 AI를 기다림(실습서버 개발용) |
| `AI_TIMEOUT_MS` | (선택) `AI_JOB_URL`이 없을 때의 AI 대기 시간(밀리초). 기본 90000 |
| `SITE_ADMIN_EMAILS` | 회사 가입을 승인하는 사이트 관리자 이메일 (쉼표로 여러 명) |
| `SMTP_USER` · `SMTP_PASS` | 인증번호 메일을 보낼 Gmail 주소와 Gmail **앱 비밀번호**(Google 계정 → 보안 → 2단계 인증을 켠 뒤 '앱 비밀번호'에서 발급, 16자리). 개발 중에 비워 두면 메일 대신 서버 터미널에 인증번호가 찍힙니다. 배포 환경에서는 꼭 넣어야 가입이 됩니다 |
| `NTS_SERVICE_KEY` | (선택) 공공데이터포털 '국세청_사업자등록정보 진위확인 및 상태조회 서비스' 일반 인증키(포털에 키가 한 칸만 보이면 그 값, 두 칸이면 Decoding). 없으면 국세청 조회는 '확인 못 함'으로 저장되고 관리자가 직접 확인합니다 |

### 배포 (Netlify + Supabase)
1. Supabase에서 새 프로젝트를 만들고(지역: Northeast Asia (Seoul)) DB 비밀번호를 정해 둡니다.
2. 프로젝트의 **Connect** → **Transaction pooler** 주소(포트 6543)를 복사하고 `[YOUR-PASSWORD]`를 DB 비밀번호로 바꿉니다. Netlify 서버는 IPv4만 쓰므로 Direct connection 주소 대신 pooler 주소를 씁니다.
3. Netlify → Site configuration → Environment variables에 `DATABASE_URL`(위 주소), `OPENROUTER_API_KEY`, `AI_JOB_URL`, `SITE_ADMIN_EMAILS`, `SMTP_USER`, `SMTP_PASS`, (선택) `NTS_SERVICE_KEY`를 넣고 다시 배포합니다. 테이블은 첫 요청 때 자동으로 만들어집니다.
3-1. **AI 초안 (Supabase Edge Function)**: Netlify 무료 서버 함수는 약 10초 안에 끝나야 하는데 무료 AI는 1~2분 걸립니다. 그래서 AI는 Supabase Edge Function(무료 최대 150초)이 뒤에서 만듭니다.
   `npm run build:edge`로 `supabase/functions/ai-draft/index.js`(lib/ai.ts까지 묶은 파일)를 만들어 함수 이름 `ai-draft`, JWT 검증 끔으로 배포합니다(작업마다 일회용 토큰으로 확인). OpenRouter 키는 Netlify가 요청 머리글로 함께 보내며, Supabase Secrets에 `OPENROUTER_API_KEY`를 넣으면 그것을 먼저 씁니다.
3-2. Netlify 무료 요금제는 크레딧제(한 달 300, 실제 배포 1번에 15)이고 다 쓰면 사이트가 멈춥니다. 작업은 `dev` 브랜치에 올리고 main에는 모아서 올립니다.
4. Netlify Build settings: Build command `npm run build`, Publish directory `.next`

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
app/page.tsx              화면: 입력 → 대책 전·후 위험성 매트릭스 → 인쇄용 평가표 서식·검사 결과 → CSV, 최근 기록
app/matrix.tsx            3×3 위험성 매트릭스 (칸을 누르면 그 칸 항목만 보기)
app/account.tsx           로그인·회사 가입·초대 수락·비밀번호 찾기·직원 관리·가입 승인 화면
app/api/assess/route.ts   평가표 만들기 (AI 또는 표준모델 검색, 실패 시 검색 초안으로 대신), AI 작업 결과 확인
app/api/history/route.ts  우리 회사 최근 기록 20개
app/api/auth/, company/, admin/   로그인·가입·초대, 직원 관리, 가입 승인 API
lib/schema.ts             평가표 형식, KRAS 6분류, 3x3 위험성 등급, 법 조항 추출
lib/validator.ts          평가표 검사기
lib/retrieve.ts           표준모델 검색 초안 (BM25, src/retrieve_draft.py와 같은 결과)
lib/ai.ts                 OpenRouter 무료 모델 호출, JSON 파싱, 검사 오류 수정 요청 (마감 시각을 넘기지 않게 재요청 조절)
lib/ai-jobs.ts            배포 사이트의 AI 작업: ai_jobs에 적고 Edge Function 호출 → 결과 확인·기록 저장
supabase/functions/ai-draft/  Supabase Edge Function (source.ts 원본 → npm run build:edge → index.js 배포)
eval/                     검증 측정 (검증 세트 20종, 재현율 채점, 사람 판정)
lib/db.ts                 PostgreSQL 접속, 테이블·RLS 자동 생성
lib/auth.ts, codes.ts, mail.ts, members.ts   비밀번호·세션, 이메일 인증번호, Gmail 발송, 직원 관리
lib/business.ts           사업자등록번호 검증 숫자, 국세청 상태 조회
lib/history.ts            회사별 평가표 기록
src/, scripts/            파이썬 데이터 처리 (표준모델 내려받기·정리, 검사기·검색 원본)
src/draft.py              (실험) Claude API로 만드는 초안. 웹 앱에서는 쓰지 않음
```

## 위험성 판단 방법
「사업장 위험성평가에 관한 지침」(고용노동부 고시 제2023-19호)이 허용하는 방법 중 소규모 사업장이 쓰기 쉬운 3x3 빈도·강도법을 씁니다. 가능성(1~3) × 중대성(1~3) → 1~2 낮음, 3~4 보통, 6~9 높음.

## 한계
- 초안 도구입니다. 법률 자문이 아니며, 위험성평가의 최종 판단과 책임은 사업주에게 있습니다.
- 표준모델이 가스공사 작업(지게차·크레인·배관·설비 점검 등) 위주라 프레스·사출 같은 일반 제조 공정은 적습니다.
- 무료 AI는 1건에 1~2분 걸리고 하루 50번까지만 부를 수 있습니다. 가끔 형식이 틀린 답을 줘 다시 부르면 2분을 넘기는데, 배포 사이트에서는 135초가 지나면 검색 초안으로 대체됩니다.
- AI도 가끔 작업 설명에 없는 설비를 지어냅니다(검증에서 초안 119개 중 틀린 항목 7개). 사람이 꼭 확인해야 합니다.
- 검증 결과(중간, 10종): 같은 기준으로 사람이 판정하면 표준모델 위험요인을 AI는 33%, 검색 초안은 8% 찾았고, 쓸 만한 항목 비율은 89% 대 44%였습니다. 자세한 내용은 [eval/README.md](eval/README.md).
