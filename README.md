# EBSD Analysis AI

금속 미세조직 이미지를 업로드하면 SEM / IPF / KAM 맵을 종류별로 분석하는 웹앱입니다.

분석은 **브라우저 안에서(Canvas)** 실행되므로 별도 서버 없이 정적 사이트로 배포됩니다.

## 라이브 사이트

`main`에 푸시되면 GitHub Actions가 자동으로 GitHub Pages에 배포합니다.

- 주소: https://yooyjsj-spec.github.io/EBSD_analysis_ai/
- 저장소의 **Deployments → github-pages → Visit site** 버튼으로도 바로 열 수 있습니다.

> 최초 1회는 저장소 **Settings → Pages → Build and deployment → Source** 를 **GitHub Actions** 로 지정해야 합니다. (워크플로우가 자동 활성화를 시도하지만 권한에 따라 수동 지정이 필요할 수 있습니다.)

## 페이지

| 경로 | 분석 |
| --- | --- |
| `/` | 메인 홈 — SEM / IPF / KAM 선택 |
| `/sem` | SEM 이미지: Grain 콘트라스트, 슬립·전위 흔적, 형태 텍스처 |
| `/ipf` | IPF 맵: Grain 크기·분율, cubic 방위 텍스처 |
| `/kam` | KAM 맵: 평균 KAM, 재결정/변형 분율, GND 근사 |

## 스케일바 자동 인식

µm/pixel 값을 직접 계산할 필요 없이, 세 페이지 모두 **스케일바 자동 인식** 버튼을 제공합니다.

1. 이미지 하단(주로 우하단)에서 스케일바 선을 찾습니다. 밝은 배경의 어두운 선, 어두운 배너의 밝은 선 모두 지원합니다.
2. 선 위아래로 튀어나온 눈금을 세어 **눈금 N칸의 픽셀 길이**를 잽니다. 검출 결과는 확대된 미리보기에 하늘색 사각형(스케일바)과 노란 선(눈금)으로 표시되므로 눈으로 확인할 수 있습니다.
3. 스케일바 옆에 적힌 실제 길이(예: `20`)만 입력하고 **적용**을 누르면 µm/pixel이 자동으로 채워집니다.

눈금을 구분하지 못하면 스케일바 양 끝 길이를 대신 사용합니다.

```bash
cd web && node scripts/test-scale-bar.mjs   # 검출 로직 합성 이미지 테스트
```

## 로컬 실행

```bash
npm install
npm run setup
npm run dev
```

브라우저: [http://localhost:3000](http://localhost:3000)

정적 사이트 빌드를 로컬에서 확인하려면:

```bash
npm run build        # web/out 에 정적 파일 생성
npx serve web/out    # 또는 임의의 정적 서버
```

## 선택: Python 백엔드

`api/` 에는 동일 분석의 정밀 버전(FastAPI + scikit-image/OpenCV)이 있습니다. 브라우저 버전은 근사치이며, 더 정확한 결과가 필요하면 백엔드를 사용할 수 있습니다.

```bash
npm run setup:api
npm run dev:api      # http://localhost:8000
```

## 테스트

```bash
npm run build        # 정적 빌드 및 타입 체크
npm run setup:api && npm test   # Python 분석 pytest
```
