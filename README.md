# EBSD Analysis AI

금속 미세조직(EBSD) 이미지를 업로드하면 Grain 크기와 분율을 자동으로 분석하는 웹앱입니다.

1차 범위는 **이미지 분할 기반 Grain 분석**입니다. 결정방위 파일(`.ctf` / `.ang`)을 이용한 ASTM E2627 분석은 후속 단계입니다.

## 구성

| 경로 | 역할 |
| --- | --- |
| `web/` | Next.js 프론트엔드 (업로드, 결과 대시보드) |
| `api/` | FastAPI 분석 API (분할, 메트릭, 오버레이) |

## 로컬 실행

### 1) 분석 API

```bash
cd api
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### 2) 웹

```bash
cd web
npm install
npm run dev
```

브라우저에서 [http://localhost:3000](http://localhost:3000) 을 엽니다. Next.js가 `/api/*` 요청을 FastAPI(`localhost:8000`)로 전달합니다.

### Docker Compose

```bash
docker compose up --build
```

- 웹: http://localhost:3000
- API: http://localhost:8000/health

## 분석 항목

- Grain 개수
- 면적, 등가원직경(ECD)
- 면적분율, 크기 구간별 분율
- D10 / D50 / D90 (면적 가중)
- ASTM G 근사값 (`G ≈ -3.2877 - 6.6439 log10(d_mm)`)
- 분할 오버레이 이미지

스케일(`µm/pixel`)을 넣지 않으면 결과는 pixel 단위로 표시됩니다.

## API

- `GET /health` — 상태 확인
- `POST /api/analyze` — `multipart/form-data`
  - `file`: PNG / JPEG / TIFF
  - `um_per_pixel` (optional)
  - `min_grain_px` (default `30`)
  - `exclude_edge` (`true` / `false`)

## 테스트

```bash
cd api
source .venv/bin/activate
pytest
```

## 분석 가정

- 입력은 IPF map, grain map 등 **색/밝기 대비가 있는 EBSD 맵 이미지**를 가정합니다.
- 같은 색이어도 떨어져 있으면 서로 다른 Grain으로 집계합니다.
- 가장자리 Grain은 잘린 단면일 수 있습니다. 기본은 포함하고, 옵션으로 제외할 수 있습니다.
- 본 결과는 ASTM E1382류 **이미지 분석**이며, 방위각 기반 E2627과 동일하지 않습니다.
