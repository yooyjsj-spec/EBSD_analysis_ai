"""Shared image decode, resize, and PNG encoding helpers."""

from __future__ import annotations

import base64
import io

import cv2
import numpy as np
from PIL import Image

MAX_LONG_EDGE = 2048
MAX_FILE_BYTES = 25 * 1024 * 1024
ALLOWED_FORMATS = {"PNG", "JPEG", "JPG", "TIFF", "TIF", "WEBP", "BMP"}


class AnalysisError(ValueError):
    """User-facing analysis failure."""


def decode_image(data: bytes) -> np.ndarray:
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


def maybe_resize(rgb: np.ndarray) -> tuple[np.ndarray, float]:
    h, w = rgb.shape[:2]
    long_edge = max(h, w)
    if long_edge <= MAX_LONG_EDGE:
        return rgb, 1.0
    scale = MAX_LONG_EDGE / long_edge
    new_w = max(1, int(round(w * scale)))
    new_h = max(1, int(round(h * scale)))
    resized = cv2.resize(rgb, (new_w, new_h), interpolation=cv2.INTER_AREA)
    return resized, scale


def encode_png(rgb: np.ndarray) -> str:
    bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
    ok, buf = cv2.imencode(".png", bgr)
    if not ok:
        raise AnalysisError("오버레이 이미지를 생성하지 못했습니다.")
    return base64.b64encode(buf.tobytes()).decode("ascii")
