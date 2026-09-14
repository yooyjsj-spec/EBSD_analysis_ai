from __future__ import annotations

import io

import numpy as np
from fastapi.testclient import TestClient
from PIL import Image

from app.analyze import analyze_image
from app.main import app

client = TestClient(app)


def _patch_image() -> bytes:
    """Four 100x100 color squares — four grains of equal area."""
    img = np.zeros((200, 200, 3), dtype=np.uint8)
    img[0:100, 0:100] = (220, 40, 40)
    img[0:100, 100:200] = (40, 80, 220)
    img[100:200, 0:100] = (40, 200, 90)
    img[100:200, 100:200] = (230, 200, 40)
    buf = io.BytesIO()
    Image.fromarray(img, mode="RGB").save(buf, format="PNG")
    return buf.getvalue()


def test_health() -> None:
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"


def test_four_color_patches_detect_four_grains() -> None:
    result = analyze_image(_patch_image(), um_per_pixel=1.0, min_grain_px=50)
    assert result["summary"]["grain_count"] == 4
    fractions = sorted(g["area_fraction"] for g in result["grains"])
    assert all(0.2 <= f <= 0.3 for f in fractions)
    assert result["summary"]["unit"] == "µm"
    assert result["summary"]["astm_g"] is not None
    assert result["overlay_png_base64"]


def test_analyze_endpoint() -> None:
    res = client.post(
        "/api/analyze",
        files={"file": ("patches.png", _patch_image(), "image/png")},
        data={"min_grain_px": "50", "um_per_pixel": "0.5"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["summary"]["grain_count"] == 4
    assert abs(sum(c["area_fraction"] for c in body["size_classes"]) - 1.0) < 1e-6


def test_pixel_units_without_scale() -> None:
    result = analyze_image(_patch_image(), um_per_pixel=None, min_grain_px=50)
    assert result["summary"]["unit"] == "px"
    assert result["summary"]["astm_g"] is None


def test_rejects_empty_file() -> None:
    res = client.post(
        "/api/analyze",
        files={"file": ("empty.png", b"", "image/png")},
    )
    assert res.status_code == 400
