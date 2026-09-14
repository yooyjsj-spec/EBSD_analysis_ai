"""Image-based EBSD grain segmentation and size / fraction metrics."""

from __future__ import annotations

import base64
import io
import math
from typing import Any

import cv2
import numpy as np
from PIL import Image
from skimage.color import label2rgb
from skimage.graph import cut_threshold, rag_mean_color
from skimage.measure import regionprops
from skimage.morphology import dilation, disk
from skimage.segmentation import expand_labels, find_boundaries, relabel_sequential

MAX_LONG_EDGE = 2048
MAX_FILE_BYTES = 25 * 1024 * 1024
ALLOWED_FORMATS = {"PNG", "JPEG", "JPG", "TIFF", "TIF", "WEBP", "BMP"}


class AnalysisError(ValueError):
    """User-facing analysis failure."""


def _decode_image(data: bytes) -> np.ndarray:
    if len(data) > MAX_FILE_BYTES:
        raise AnalysisError("이미지 크기는 25MB 이하여야 합니다.")

    pil = Image.open(io.BytesIO(data))
    fmt = (pil.format or "").upper()
    if fmt not in ALLOWED_FORMATS:
        raise AnalysisError("PNG, JPEG, TIFF 이미지만 지원합니다.")

    rgb = np.array(pil.convert("RGB"))
    if rgb.size == 0:
        raise AnalysisError("이미지를 읽을 수 없습니다.")
    return rgb


def _maybe_resize(rgb: np.ndarray) -> tuple[np.ndarray, float]:
    h, w = rgb.shape[:2]
    long_edge = max(h, w)
    if long_edge <= MAX_LONG_EDGE:
        return rgb, 1.0
    scale = MAX_LONG_EDGE / long_edge
    new_w = max(1, int(round(w * scale)))
    new_h = max(1, int(round(h * scale)))
    resized = cv2.resize(rgb, (new_w, new_h), interpolation=cv2.INTER_AREA)
    return resized, scale


def _connected_components_by_value(color_ids: np.ndarray) -> np.ndarray:
    """4-connected components that stay within the same quantized color."""
    labels = np.zeros(color_ids.shape, dtype=np.int32)
    next_id = 1
    for value in np.unique(color_ids):
        mask = (color_ids == value).astype(np.uint8)
        count, components = cv2.connectedComponents(mask, connectivity=4)
        for idx in range(1, count):
            labels[components == idx] = next_id
            next_id += 1
    return labels


def _segment(rgb: np.ndarray, min_area_px: int) -> tuple[np.ndarray, str]:
    """Segment grains by Lab quantization + connected components (IPF-friendly)."""
    smooth = cv2.bilateralFilter(rgb, d=7, sigmaColor=35, sigmaSpace=7)
    lab = cv2.cvtColor(smooth, cv2.COLOR_RGB2LAB)
    bin_size = 12
    quant = (lab.astype(np.int32) // bin_size)
    color_ids = (quant[:, :, 0] << 16) + (quant[:, :, 1] << 8) + quant[:, :, 2]
    labels = _connected_components_by_value(color_ids)

    if int(labels.max()) > 1:
        rag = rag_mean_color(smooth, labels, mode="distance")
        labels = cut_threshold(labels, rag, thresh=22)
        labels = np.asarray(labels, dtype=np.int32)
        if int(labels.min()) < 1:
            labels = labels - int(labels.min()) + 1

    labels = _absorb_small_regions(labels, min_area_px)
    labels, _, _ = relabel_sequential(labels)
    return labels.astype(np.int32), "lab_quantize_cc"


def _absorb_small_regions(labels: np.ndarray, min_area_px: int) -> np.ndarray:
    cleaned = labels.copy()
    for region in regionprops(cleaned):
        if region.area < min_area_px:
            cleaned[cleaned == region.label] = 0
    if np.any(cleaned == 0) and np.any(cleaned > 0):
        cleaned = expand_labels(cleaned, distance=max(4, int(math.sqrt(min_area_px))))
    return cleaned


def _percentile_from_cdf(values: np.ndarray, weights: np.ndarray, q: float) -> float:
    if values.size == 0:
        return 0.0
    order = np.argsort(values)
    v = values[order]
    w = weights[order]
    cdf = np.cumsum(w)
    total = cdf[-1]
    if total <= 0:
        return float(v[-1])
    cdf = cdf / total
    return float(np.interp(q / 100.0, cdf, v))


def _astm_g_from_ecd_um(mean_ecd_um: float | None) -> float | None:
    if mean_ecd_um is None or mean_ecd_um <= 0:
        return None
    d_mm = mean_ecd_um / 1000.0
    return float(-3.2877 - 6.6439 * math.log10(d_mm))


def _histogram(ecds: np.ndarray, areas: np.ndarray, bins: int = 12) -> list[dict[str, float | int]]:
    if ecds.size == 0:
        return []
    lo, hi = float(ecds.min()), float(ecds.max())
    if math.isclose(lo, hi):
        hi = lo + 1.0
    if hi / max(lo, 1e-9) > 8:
        edges = np.geomspace(max(lo, 1e-6), hi, bins + 1)
    else:
        edges = np.linspace(lo, hi, bins + 1)

    total_area = float(areas.sum()) or 1.0
    hist: list[dict[str, float | int]] = []
    for i in range(len(edges) - 1):
        mask = (ecds >= edges[i]) & (ecds < edges[i + 1] if i < len(edges) - 2 else ecds <= edges[i + 1])
        hist.append(
            {
                "bin_start": float(edges[i]),
                "bin_end": float(edges[i + 1]),
                "count": int(mask.sum()),
                "area_fraction": float(areas[mask].sum() / total_area),
            }
        )
    return hist


def _size_classes(ecds: np.ndarray, areas: np.ndarray, has_scale: bool) -> list[dict[str, float | int | str]]:
    if has_scale:
        edges = [0.0, 5.0, 10.0, 20.0, 50.0, 100.0, float("inf")]
        labels = ["<5 µm", "5–10 µm", "10–20 µm", "20–50 µm", "50–100 µm", ">100 µm"]
    else:
        edges = [0.0, 20.0, 50.0, 100.0, 250.0, 500.0, float("inf")]
        labels = ["<20 px", "20–50 px", "50–100 px", "100–250 px", "250–500 px", ">500 px"]

    total_area = float(areas.sum()) or 1.0
    classes: list[dict[str, float | int | str]] = []
    for i, name in enumerate(labels):
        mask = (ecds >= edges[i]) & (ecds < edges[i + 1])
        classes.append(
            {
                "label": name,
                "count": int(mask.sum()),
                "area_fraction": float(areas[mask].sum() / total_area),
            }
        )
    return classes


def _encode_overlay(rgb: np.ndarray, labels: np.ndarray) -> str:
    tinted = label2rgb(labels, image=rgb, bg_label=0, alpha=0.38, saturation=0.75)
    overlay = (np.clip(tinted, 0, 1) * 255).astype(np.uint8)
    bounds = find_boundaries(labels, mode="outer")
    thick = dilation(bounds, disk(1))
    overlay[thick] = np.array([255, 208, 64], dtype=np.uint8)
    bgr = cv2.cvtColor(overlay, cv2.COLOR_RGB2BGR)
    ok, buf = cv2.imencode(".png", bgr)
    if not ok:
        raise AnalysisError("오버레이 이미지를 생성하지 못했습니다.")
    return base64.b64encode(buf.tobytes()).decode("ascii")


def analyze_image(
    data: bytes,
    um_per_pixel: float | None = None,
    min_grain_px: int = 30,
    exclude_edge: bool = False,
) -> dict[str, Any]:
    if min_grain_px < 4:
        raise AnalysisError("최소 Grain 면적은 4 px 이상이어야 합니다.")
    if um_per_pixel is not None and um_per_pixel <= 0:
        raise AnalysisError("µm/pixel 값은 0보다 커야 합니다.")

    original = _decode_image(data)
    orig_h, orig_w = original.shape[:2]
    rgb, resize_scale = _maybe_resize(original)
    min_area_resized = max(4, int(round(min_grain_px * resize_scale * resize_scale)))

    labels, method = _segment(rgb, min_area_resized)
    h, w = rgb.shape[:2]
    area_to_original = 1.0 / (resize_scale * resize_scale)
    um_per_px_orig = um_per_pixel
    has_scale = um_per_px_orig is not None

    grains: list[dict[str, Any]] = []
    edge_count = 0
    for region in regionprops(labels):
        coords = region.coords
        touches_edge = bool(
            np.any(coords[:, 0] == 0)
            or np.any(coords[:, 0] == h - 1)
            or np.any(coords[:, 1] == 0)
            or np.any(coords[:, 1] == w - 1)
        )
        if touches_edge:
            edge_count += 1
        if exclude_edge and touches_edge:
            continue

        area_px = float(region.area * area_to_original)
        if has_scale:
            area_phys = area_px * (um_per_px_orig**2)
            ecd = 2.0 * math.sqrt(area_phys / math.pi)
        else:
            area_phys = area_px
            ecd = 2.0 * math.sqrt(area_px / math.pi)

        cy, cx = region.centroid
        grains.append(
            {
                "id": int(region.label),
                "area_px": area_px,
                "area": area_phys,
                "ecd": ecd,
                "touches_edge": touches_edge,
                "centroid_x": float(cx / resize_scale),
                "centroid_y": float(cy / resize_scale),
            }
        )

    if not grains:
        raise AnalysisError("검출된 Grain이 없습니다. 최소 면적을 낮추거나 다른 이미지를 사용해 보세요.")

    grains.sort(key=lambda g: g["area"], reverse=True)
    areas = np.array([g["area"] for g in grains], dtype=np.float64)
    ecds = np.array([g["ecd"] for g in grains], dtype=np.float64)
    total_area = float(areas.sum())
    for grain in grains:
        grain["area_fraction"] = grain["area"] / total_area if total_area else 0.0

    mean_ecd = float(ecds.mean())
    median_ecd = float(np.median(ecds))
    d10 = _percentile_from_cdf(ecds, areas, 10)
    d50 = _percentile_from_cdf(ecds, areas, 50)
    d90 = _percentile_from_cdf(ecds, areas, 90)
    astm_g = _astm_g_from_ecd_um(mean_ecd if has_scale else None)

    unit = "µm" if has_scale else "px"
    overlay = _encode_overlay(rgb, labels)
    analyzed_pixels = float(sum(g["area_px"] for g in grains))
    notes = [
        "이미지 분할(ASTM E1382류) 결과입니다. 방위각 파일 기반 ASTM E2627과 동일하지 않습니다.",
        "같은 색이어도 공간적으로 떨어지면 서로 다른 Grain으로 집계합니다.",
    ]
    if not has_scale:
        notes.append("스케일(µm/pixel)이 없어 길이와 면적은 pixel 단위입니다. ASTM G는 계산하지 않습니다.")
    if exclude_edge:
        notes.append("가장자리에 닿은 Grain은 통계에서 제외했습니다.")
    else:
        notes.append("가장자리 Grain은 잘렸을 수 있어 크기가 과소평가될 수 있습니다.")

    return {
        "summary": {
            "grain_count": len(grains),
            "edge_grain_count": edge_count,
            "mean_ecd": mean_ecd,
            "median_ecd": median_ecd,
            "d10": d10,
            "d50": d50,
            "d90": d90,
            "astm_g": astm_g,
            "unit": unit,
            "image_width": orig_w,
            "image_height": orig_h,
            "scale_um_per_px": um_per_px_orig,
            "analyzed_area_fraction": analyzed_pixels / (orig_w * orig_h),
            "method": method,
            "min_grain_px": min_grain_px,
            "exclude_edge": exclude_edge,
        },
        "histogram": _histogram(ecds, areas),
        "size_classes": _size_classes(ecds, areas, has_scale),
        "grains": grains,
        "overlay_png_base64": overlay,
        "notes": notes,
    }
