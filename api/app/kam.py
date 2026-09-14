"""KAM map analysis: strain, recrystallized fraction, GND density proxy."""

from __future__ import annotations

import math
from typing import Any

import cv2
import numpy as np

from app.image_io import AnalysisError, decode_image, encode_png, maybe_resize

# Typical Burgers vector for bcc Fe (nm). Used only for GND proxy.
DEFAULT_BURGERS_NM = 0.248


def kam_field(rgb: np.ndarray) -> np.ndarray:
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
    hue = hsv[:, :, 0].astype(np.float32)
    sat = hsv[:, :, 1].astype(np.float32) / 255.0
    val = hsv[:, :, 2].astype(np.float32) / 255.0
    if float(sat.mean()) < 0.18:
        return val
    # Jet/rainbow KAM: blue (OpenCV H≈120) = low, red (H≈0) = high.
    mapped = np.clip((120.0 - hue) / 120.0, 0.0, 1.0)
    mapped = np.where(hue > 145.0, 1.0, mapped)
    return mapped


def _histogram(values: np.ndarray, max_value: float, bins: int = 12) -> list[dict[str, float | int]]:
    edges = np.linspace(0.0, max_value, bins + 1)
    hist, _ = np.histogram(values, bins=edges)
    total = float(hist.sum()) or 1.0
    return [
        {
            "bin_start": float(edges[i]),
            "bin_end": float(edges[i + 1]),
            "count": int(hist[i]),
            "area_fraction": float(hist[i] / total),
        }
        for i in range(bins)
    ]


def _encode_kam_overlay(rgb: np.ndarray, kam_deg: np.ndarray, high_cut: float) -> str:
    overlay = rgb.copy()
    mask = kam_deg >= high_cut
    heat = np.zeros_like(overlay)
    heat[:, :, 0] = np.clip(kam_deg / max(high_cut, 1e-6) * 255, 0, 255).astype(np.uint8)
    heat[:, :, 2] = 40
    overlay = cv2.addWeighted(overlay, 0.55, heat, 0.45, 0)
    overlay[mask] = (0.45 * overlay[mask] + 0.55 * np.array([255, 80, 40])).astype(np.uint8)
    return encode_png(overlay)


def analyze_kam(
    data: bytes,
    um_per_pixel: float | None = None,
    max_kam_deg: float = 5.0,
    recrystallized_cut: float = 1.0,
    deformed_cut: float = 2.5,
) -> dict[str, Any]:
    if max_kam_deg <= 0:
        raise AnalysisError("KAM 최댓값은 0보다 커야 합니다.")
    if um_per_pixel is not None and um_per_pixel <= 0:
        raise AnalysisError("µm/pixel 값은 0보다 커야 합니다.")
    if not 0 < recrystallized_cut < deformed_cut:
        raise AnalysisError("재결정 임계값은 변형 임계값보다 작아야 합니다.")

    original = decode_image(data)
    orig_h, orig_w = original.shape[:2]
    rgb, _resize_scale = maybe_resize(original)
    field = kam_field(rgb)
    kam_deg = field * max_kam_deg

    mean_kam = float(kam_deg.mean())
    median_kam = float(np.median(kam_deg))
    rx = float((kam_deg < recrystallized_cut).mean())
    recovered = float(((kam_deg >= recrystallized_cut) & (kam_deg < deformed_cut)).mean())
    deformed = float((kam_deg >= deformed_cut).mean())

    gnd = None
    gnd_unit = "m⁻²"
    if um_per_pixel is not None:
        theta = mean_kam * math.pi / 180.0
        step_m = um_per_pixel * 1e-6
        burgers_m = DEFAULT_BURGERS_NM * 1e-9
        gnd = float(theta / (burgers_m * step_m))

    overlay = _encode_kam_overlay(rgb, kam_deg, deformed_cut)
    notes = [
        "컬러 KAM 맵의 색(파랑=낮음, 빨강=높음)을 각도로 환산한 이미지 분석입니다. .ctf/.ang 기반 KAM과 동일하지 않습니다.",
        f"색 스케일은 사용자가 지정한 최댓값 {max_kam_deg:g}°에 선형 매핑됩니다.",
        f"재결정 분율은 KAM < {recrystallized_cut:g}°, 변형 분율은 KAM ≥ {deformed_cut:g}°로 집계합니다.",
    ]
    if gnd is None:
        notes.append("GND 밀도 근사는 스텝 크기(µm/pixel)가 필요합니다.")
    else:
        notes.append("GND 밀도는 ρ ≈ θ / (b · λ) 근사입니다 (b=0.248 nm, bcc Fe).")

    return {
        "kind": "kam",
        "summary": {
            "mean_kam_deg": mean_kam,
            "median_kam_deg": median_kam,
            "recrystallized_fraction": rx,
            "recovered_fraction": recovered,
            "deformed_fraction": deformed,
            "gnd_density": gnd,
            "gnd_unit": gnd_unit,
            "max_kam_deg": max_kam_deg,
            "image_width": orig_w,
            "image_height": orig_h,
            "scale_um_per_px": um_per_pixel,
            "method": "colormap_kam",
        },
        "histogram": _histogram(kam_deg, max_kam_deg),
        "classes": [
            {"label": f"재결정 <{recrystallized_cut:g}°", "area_fraction": rx},
            {"label": f"회복 {recrystallized_cut:g}–{deformed_cut:g}°", "area_fraction": recovered},
            {"label": f"변형 ≥{deformed_cut:g}°", "area_fraction": deformed},
        ],
        "overlay_png_base64": overlay,
        "notes": notes,
    }
