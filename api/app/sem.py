"""SEM image analysis: slip/dislocation traces, grain contrast, morphological texture."""

from __future__ import annotations

import math
from typing import Any

import cv2
import numpy as np
from skimage.morphology import dilation, disk
from skimage.segmentation import find_boundaries, relabel_sequential, watershed
from skimage.filters import sobel

from app.analyze import _absorb_small_regions, _segment
from app.image_io import AnalysisError, decode_image, encode_png, maybe_resize


def _gray_enhance(rgb: np.ndarray) -> np.ndarray:
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    clahe = cv2.createCLAHE(clipLimit=2.4, tileGridSize=(8, 8))
    return clahe.apply(gray)


def _segment_sem(rgb: np.ndarray, gray: np.ndarray, min_area_px: int) -> np.ndarray:
    """Prefer channeling-contrast grayscale watershed; fall back to color grains."""
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    gradient = sobel(blur.astype(np.float32) / 255.0)
    markers = cv2.connectedComponents((gradient < np.percentile(gradient, 18)).astype(np.uint8))[1]
    labels = watershed(gradient, markers)
    labels = np.asarray(labels, dtype=np.int32)
    if int(labels.max()) <= 1:
        labels, _ = _segment(rgb, min_area_px)
        return labels
    labels = _absorb_small_regions(labels, min_area_px)
    labels, _, _ = relabel_sequential(labels)
    return labels.astype(np.int32)


def _detect_traces(gray: np.ndarray, min_length: int) -> tuple[list[tuple[int, int, int, int]], float]:
    edges = cv2.Canny(gray, 55, 140)
    lines = cv2.HoughLinesP(
        edges,
        rho=1,
        theta=np.pi / 180,
        threshold=max(18, min_length // 2),
        minLineLength=min_length,
        maxLineGap=4,
    )
    traces: list[tuple[int, int, int, int]] = []
    total_len = 0.0
    if lines is not None:
        for x1, y1, x2, y2 in lines[:, 0]:
            traces.append((int(x1), int(y1), int(x2), int(y2)))
            total_len += float(math.hypot(int(x2) - int(x1), int(y2) - int(y1)))
    return traces, total_len


def _orientation_texture(gray: np.ndarray) -> tuple[list[dict[str, float | str]], float]:
    gx = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
    mag = np.sqrt(gx * gx + gy * gy)
    ang = (np.degrees(np.arctan2(gy, gx)) + 180.0) % 180.0
    strong = mag > np.percentile(mag, 70)
    if not np.any(strong):
        return [{"label": f"{i * 22.5:.0f}°", "fraction": 0.0} for i in range(8)], 0.0
    bins = np.linspace(0, 180, 9)
    hist, _ = np.histogram(ang[strong], bins=bins, weights=mag[strong])
    total = float(hist.sum()) or 1.0
    fractions = hist / total
    mean = float(fractions.mean()) or 1e-9
    anisotropy = float(fractions.max() / mean)
    texture = [
        {"label": f"{bins[i]:.0f}–{bins[i + 1]:.0f}°", "fraction": float(fractions[i])}
        for i in range(8)
    ]
    return texture, anisotropy


def _encode_sem_overlay(rgb: np.ndarray, labels: np.ndarray, traces: list[tuple[int, int, int, int]]) -> str:
    overlay = rgb.copy()
    bounds = find_boundaries(labels, mode="outer")
    overlay[dilation(bounds, disk(1))] = np.array([80, 200, 255], dtype=np.uint8)
    for x1, y1, x2, y2 in traces[:800]:
        cv2.line(overlay, (x1, y1), (x2, y2), (255, 208, 64), 1, cv2.LINE_AA)
    return encode_png(overlay)


def analyze_sem(
    data: bytes,
    um_per_pixel: float | None = None,
    min_feature_px: int = 20,
) -> dict[str, Any]:
    if min_feature_px < 4:
        raise AnalysisError("최소 특징 크기는 4 px 이상이어야 합니다.")
    if um_per_pixel is not None and um_per_pixel <= 0:
        raise AnalysisError("µm/pixel 값은 0보다 커야 합니다.")

    original = decode_image(data)
    orig_h, orig_w = original.shape[:2]
    rgb, resize_scale = maybe_resize(original)
    h, w = rgb.shape[:2]
    gray = _gray_enhance(rgb)
    min_area = max(8, int(round(min_feature_px * resize_scale * resize_scale)))
    labels = _segment_sem(rgb, gray, min_area)
    grain_count = int(max(labels.max(), 0))
    traces, total_len_resized = _detect_traces(gray, min_length=max(12, min_feature_px))
    length_orig = total_len_resized / max(resize_scale, 1e-9)
    area_px = float(orig_w * orig_h)
    if um_per_pixel:
        area_um2 = area_px * (um_per_pixel**2)
        density = length_orig * um_per_pixel / max(area_um2, 1e-9)
        density_unit = "µm⁻¹"
    else:
        density = length_orig / max(area_px, 1.0)
        density_unit = "px⁻¹"

    contrast = float(np.std(gray) / 255.0)
    local = cv2.blur(gray.astype(np.float32), (9, 9))
    substructure = float(np.mean(np.abs(gray.astype(np.float32) - local)) / 255.0)
    texture_bins, anisotropy = _orientation_texture(gray)
    overlay = _encode_sem_overlay(rgb, labels, traces)

    notes = [
        "SEM 이차전자/채널링 콘트라스트 이미지에서 추정한 결과입니다. TEM 전위 관찰이나 ECCI 정량과 동일하지 않습니다.",
        "금색 선은 슬립 밴드·전위 콘트라스트 등 선형 흔적 후보입니다.",
        "시안색 경계는 채널링 콘트라스트로 나눈 Grain 후보입니다.",
        "텍스처는 결정방위가 아니라 표면 형상/콘트라스트의 방향 이방성입니다.",
    ]
    if um_per_pixel is None:
        notes.append("스케일이 없어 전위 흔적 밀도는 pixel 단위입니다.")

    return {
        "kind": "sem",
        "summary": {
            "grain_count": grain_count,
            "trace_count": len(traces),
            "trace_density": density,
            "density_unit": density_unit,
            "contrast": contrast,
            "substructure": substructure,
            "anisotropy": anisotropy,
            "unit": "µm" if um_per_pixel else "px",
            "image_width": orig_w,
            "image_height": orig_h,
            "scale_um_per_px": um_per_pixel,
            "method": "clahe_watershed_hough",
        },
        "texture": texture_bins,
        "overlay_png_base64": overlay,
        "notes": notes,
    }
