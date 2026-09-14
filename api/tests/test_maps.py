from __future__ import annotations

import io

import numpy as np
from PIL import Image

from app.kam import analyze_kam
from app.main import app
from app.sem import analyze_sem
from fastapi.testclient import TestClient

client = TestClient(app)


def _png(array: np.ndarray) -> bytes:
    buf = io.BytesIO()
    Image.fromarray(array, mode="RGB").save(buf, format="PNG")
    return buf.getvalue()


def _sem_image() -> bytes:
    img = np.full((240, 320, 3), 90, dtype=np.uint8)
    img[20:110, 20:150] = 70
    img[20:110, 170:300] = 130
    img[130:220, 40:280] = 50
    for y in range(40, 100):
        img[y, 40:148] = 200
    for x in range(180, 290):
        img[40:108, x] = 30 if (x // 6) % 2 == 0 else 160
    return _png(img)


def _kam_image() -> bytes:
    """Left third blue (low KAM), right third red (high KAM)."""
    img = np.zeros((120, 180, 3), dtype=np.uint8)
    img[:, 0:60] = (20, 40, 210)
    img[:, 60:120] = (40, 190, 70)
    img[:, 120:180] = (220, 30, 30)
    return _png(img)


def test_sem_endpoint_returns_traces_and_texture() -> None:
    res = client.post(
        "/api/analyze/sem",
        files={"file": ("sem.png", _sem_image(), "image/png")},
        data={"min_feature_px": "12", "um_per_pixel": "0.4"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["kind"] == "sem"
    assert body["summary"]["grain_count"] >= 1
    assert body["summary"]["trace_count"] >= 1
    assert body["summary"]["trace_density"] > 0
    assert len(body["texture"]) == 8
    assert body["overlay_png_base64"]


def test_kam_endpoint_splits_low_and_high() -> None:
    res = client.post(
        "/api/analyze/kam",
        files={"file": ("kam.png", _kam_image(), "image/png")},
        data={"max_kam_deg": "5", "recrystallized_cut": "1", "deformed_cut": "2.5", "um_per_pixel": "0.5"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["kind"] == "kam"
    assert body["summary"]["recrystallized_fraction"] > 0.2
    assert body["summary"]["deformed_fraction"] > 0.2
    assert body["summary"]["gnd_density"] is not None
    assert abs(sum(c["area_fraction"] for c in body["classes"]) - 1.0) < 1e-6


def test_ipf_alias_and_texture() -> None:
    img = np.zeros((120, 120, 3), dtype=np.uint8)
    img[0:60, 0:60] = (220, 30, 30)
    img[0:60, 60:120] = (30, 40, 210)
    img[60:120, 0:60] = (30, 200, 50)
    img[60:120, 60:120] = (220, 30, 30)
    res = client.post(
        "/api/analyze/ipf",
        files={"file": ("ipf.png", _png(img), "image/png")},
        data={"min_grain_px": "40"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["kind"] == "ipf"
    assert body["summary"]["grain_count"] >= 3
    assert "texture_index" in body["summary"]
    assert len(body["texture"]) == 4


def test_kam_direct_helper() -> None:
    result = analyze_kam(_kam_image(), max_kam_deg=5.0)
    assert result["summary"]["mean_kam_deg"] > 0


def test_sem_direct_helper() -> None:
    result = analyze_sem(_sem_image(), min_feature_px=10)
    assert result["summary"]["anisotropy"] >= 1.0
