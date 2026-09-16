# EBSD Analysis AI

금속 미세조직 이미지를 업로드하면 SEM / IPF / KAM / 파면 맵을 종류별로 분석하는 웹앱입니다.

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
| `/fracture` | SEM 파면: facet/딤플 분할, 등가지름, 능선 방향 |

GitHub에 올린 원본 데모 HTML도 정적 사이트로 같이 배포됩니다.

- https://yooyjsj-spec.github.io/EBSD_analysis_ai/fractography/fracture_analysis_demo.html

## 스케일바 자동 인식

µm/pixel 값을 직접 계산할 필요 없이, 세 페이지 모두 **스케일바 자동 인식** 버튼을 제공합니다.

1. 이미지 하단 데이터 배너에서 스케일바를 찾습니다. 연결 선이 있는 자와, TESCAN처럼 **눈금만 11개 나열된 자**(첫 눈금~마지막 눈금 = 10칸)를 모두 지원합니다. 왼쪽 `KOOKMIN …` 글자를 첫 눈금으로 오인하지 않습니다.
2. 첫 눈금부터 마지막 눈금까지의 픽셀 길이를 잽니다. 미리보기에 하늘색 사각형과 노란 선으로 표시됩니다.
3. 옆에 적힌 `500µm` 같은 라벨을 읽으면 10칸의 실제 길이를 자동으로 채웁니다. 못 읽으면 프리셋에서 고르면 됩니다.

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
