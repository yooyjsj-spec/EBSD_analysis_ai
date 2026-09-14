from __future__ import annotations

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from app.analyze import AnalysisError, analyze_image

app = FastAPI(title="EBSD Grain Analysis API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "ebsd-grain-api"}


@app.post("/api/analyze")
async def analyze(
    file: UploadFile = File(...),
    um_per_pixel: float | None = Form(default=None),
    min_grain_px: int = Form(default=30),
    exclude_edge: bool = Form(default=False),
) -> dict:
    if not file.filename:
        raise HTTPException(status_code=400, detail="파일이 필요합니다.")

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="빈 파일입니다.")

    try:
        return analyze_image(
            data,
            um_per_pixel=um_per_pixel,
            min_grain_px=min_grain_px,
            exclude_edge=exclude_edge,
        )
    except AnalysisError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover - unexpected backend failure
        raise HTTPException(status_code=500, detail="분석 중 오류가 발생했습니다.") from exc
