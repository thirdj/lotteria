# 🎰 LOTTO 6/45 빅데이터 번호 분석기

동행복권 API를 Vercel Edge Functions로 프록시하는 풀스택 로또 분석 앱입니다.

## 📁 프로젝트 구조

```
lotto-app/
├── api/
│   ├── lotto.js          # 단일 회차 조회
│   ├── lotto-batch.js    # 최대 100회차 병렬 조회
│   └── lotto-latest.js   # 최신 회차 자동 탐색
├── public/
│   └── index.html        # 프론트엔드 (SPA)
├── vercel.json           # Vercel 설정
└── package.json
```

## 🚀 Vercel 배포 방법

### 방법 1 — Vercel CLI (추천)

```bash
# 1. Node.js 설치 확인
node -v   # v18 이상 권장

# 2. Vercel CLI 설치
npm install -g vercel

# 3. 프로젝트 폴더로 이동
cd lotto-app

# 4. 배포
vercel

# 처음 배포 시 질문:
# - Set up and deploy? → Y
# - Which scope? → 본인 계정 선택
# - Link to existing project? → N
# - Project name? → lotto-app (원하는 이름)
# - In which directory is your code? → ./ (그냥 엔터)
# - Want to override settings? → N

# 5. 완료! 출력된 URL로 접속
```

### 방법 2 — GitHub 연동 (자동 배포)

```bash
# 1. GitHub 레포 생성 후 push
git init
git add .
git commit -m "init: lotto proxy app"
git remote add origin https://github.com/your-id/lotto-app.git
git push -u origin main

# 2. https://vercel.com → New Project → Import Git Repository
# 3. 레포 선택 → Deploy 클릭
# 4. 이후 git push 할 때마다 자동 재배포
```

## 🔌 API 엔드포인트

배포 후 아래 엔드포인트가 자동 생성됩니다.

| 엔드포인트 | 설명 | 예시 |
|---|---|---|
| `GET /api/lotto?round=1150` | 특정 회차 조회 | `?round=1150` |
| `GET /api/lotto-batch?from=1100&to=1150` | 범위 일괄 조회 (최대 100회차) | `?from=1100&to=1150` |
| `GET /api/lotto-latest` | 최신 회차 자동 탐색 + 상세 | — |

## ⚙️ 캐시 전략

| API | 캐시 시간 | 이유 |
|---|---|---|
| `/api/lotto` | 1시간 | 과거 데이터는 불변 |
| `/api/lotto-batch` | 1시간 | 동일 |
| `/api/lotto-latest` | 30분 | 토요일 추첨 후 빠른 반영 |

Vercel Edge Cache + 브라우저 캐시 모두 적용됩니다.

## 🛠 로컬 개발

```bash
npm install
npx vercel dev
# → http://localhost:3000 에서 확인
```

## 📌 참고

- 동행복권 공식 API: `https://www.dhlottery.co.kr/common.do?method=getLottoNumber&drwNo={회차}`
- Vercel 무료 플랜으로도 완전히 동작합니다 (Edge Function 제한 없음)
- API 장애 시 프론트엔드가 자동으로 데모 데이터 모드로 전환됩니다
# lotteria
