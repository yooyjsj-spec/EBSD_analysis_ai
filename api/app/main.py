from __future__ import annotations

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from app.analyze import AnalysisError, analyze_image
from app.kam import analyze_kam
from app.sem import analyze_sem

app = FastAPI(title="EBSD Analysis API", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "ebsd-grain-api"}


async def _payload(file: UploadFile) -> bytes:
    if not file.filename:
        raise HTTPException(status_code=400, detail="파일이 필요합니다.")
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="빈 파일입니다.")
    return data


def _run(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except AnalysisError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail="분석 중 오류가 발생했습니다.") from exc


@app.post("/api/analyze")
@app.post("/api/analyze/ipf")
async def analyze_ipf(
    file: UploadFile = File(...),
    um_per_pixel: float | None = Form(default=None),
    min_grain_px: int = Form(default=30),
    exclude_edge: bool = Form(default=False),
) -> dict:
    data = await _payload(file)
    return _run(
        analyze_image,
        data,
        um_per_pixel=um_per_pixel,
        min_grain_px=min_grain_px,
        exclude_edge=exclude_edge,
    )


@app.post("/api/analyze/sem")
async def analyze_sem_endpoint(
    file: UploadFile = File(...),
    um_per_pixel: float | None = Form(default=None),
    min_feature_px: int = Form(default=20),
) -> dict:
    data = await _payload(file)
    return _run(analyze_sem, data, um_per_pixel=um_per_pixel, min_feature_px=min_feature_px)


@app.post("/api/analyze/kam")
async def analyze_kam_endpoint(
    file: UploadFile = File(...),
    um_per_pixel: float | None = Form(default=None),
    max_kam_deg: float = Form(default=5.0),
    recrystallized_cut: float = Form(default=1.0),
    deformed_cut: float = Form(default=2.5),
) -> dict:
    data = await _payload(file)
    return _run(
        analyze_kam,
        data,
        um_per_pixel=um_per_pixel,
        max_kam_deg=max_kam_deg,
        recrystallized_cut=recrystallized_cut,
        deformed_cut=deformed_cut,
    )
