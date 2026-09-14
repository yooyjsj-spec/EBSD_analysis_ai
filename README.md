# EBSD Analysis AI

금속 미세조직 이미지를 업로드하면 SEM / IPF / KAM 맵을 종류별로 분석하는 웹앱입니다.

결정방위 파일(`.ctf` / `.ang`)을 이용한 ASTM E2627 정량 분석은 후속 단계입니다. 현재는 맵 이미지 기반 분석입니다.

## 페이지

| 경로 | 분석 |
| --- | --- |
| `/` | 메인 홈 — SEM / IPF / KAM 선택 |
| `/sem` | SEM 이미지: Grain 콘트라스트, 슬립·전위 흔적, 형태 텍스처 |
| `/ipf` | IPF 맵: Grain 크기·분율, cubic 방위 텍스처 |
| `/kam` | KAM 맵: 평균 KAM, 재결정/변형 분율, GND 근사 |

## 로컬 실행

```bash
npm install
npm run setup
npm run dev
```

브라우저: [http://localhost:3000](http://localhost:3000)

## API

- `GET /health`
- `POST /api/analyze/ipf`
- `POST /api/analyze/sem`
- `POST /api/analyze/kam`

공통: `file` (PNG/JPEG/TIFF), `um_per_pixel` (선택)

## 테스트

```bash
npm test
npm run build
```
