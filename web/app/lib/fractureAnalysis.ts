import {
  boundaryMask,
  boxBlur,
  findSeeds,
  orientationHistogram,
  regionAreas,
  sizeReport,
  sobel,
  watershed,
} from "./fractoCore";
import type { FractureResult, HistogramBin } from "./types";

const MAX_EDGE = 700;

async function loadImage(file: File) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("이미지를 읽을 수 없습니다."));
      el.src = url;
    });
    const ow = img.naturalWidth;
    const oh = img.naturalHeight;
    if (!ow || !oh) throw new Error("이미지를 읽을 수 없습니다.");
    const scale = Math.min(1, MAX_EDGE / Math.max(ow, oh));
    const w = Math.max(1, Math.round(ow * scale));
    const h = Math.max(1, Math.round(oh * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Canvas를 사용할 수 없습니다.");
    ctx.drawImage(img, 0, 0, w, h);
    return { data: ctx.getImageData(0, 0, w, h).data, w, h, ow, oh, scale };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function overlayToBase64(w: number, h: number, pixels: Uint8ClampedArray): string {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas를 사용할 수 없습니다.");
  const imageData = ctx.createImageData(w, h);
  imageData.data.set(pixels);
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL("image/png").split(",")[1];
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return NaN;
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx];
}

export async function runFracture(
  file: File,
  opts: {
    umPerPixel?: number | null;
    blurRadius?: number;
    minDist?: number;
    oriThresh?: number;
    topN?: number;
  } = {},
): Promise<FractureResult> {
  const loaded = await loadImage(file);
  const { data, w, h, ow, oh, scale } = loaded;
  const gray = new Float32Array(w * h);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    gray[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
  }

  const userPxSize = opts.umPerPixel && opts.umPerPixel > 0 ? opts.umPerPixel : null;
  const effectivePxSize = (userPxSize ?? 1) / Math.max(scale, 1e-9);
  const blurRadius = opts.blurRadius ?? 3;
  const minDist = opts.minDist ?? 10;
  const oriThresh = opts.oriThresh ?? 0.85;
  const topN = opts.topN ?? 20;

  const smoothed = boxBlur(gray, w, h, blurRadius, 2);
  const { markers, count } = findSeeds(smoothed, w, h, minDist);
  if (count < 2) throw new Error("facet 씨앗을 충분히 찾지 못했습니다. 최소 셀 간격을 줄여 보세요.");
  const { gx, gy, mag } = sobel(smoothed, w, h);
  const labels = watershed(mag, markers, w, h);
  const areasPx = regionAreas(labels, count);
  const bmask = boundaryMask(labels, w, h);

  const minAreaPx = Math.max(9, Math.round((minDist * minDist) / 8));
  const diam = [];
  for (const a of areasPx) {
    if (a < minAreaPx) continue;
    const dPx = 2 * Math.sqrt(a / Math.PI);
    diam.push(dPx * effectivePxSize);
  }
  diam.sort((a, b) => a - b);
  if (!diam.length) throw new Error("유효한 facet을 찾지 못했습니다. 최소 셀 간격을 조정해 보세요.");

  const pixels = new Uint8ClampedArray(data);
  for (let i = 0; i < w * h; i++) {
    if (!bmask[i]) continue;
    pixels[i * 4] = 209;
    pixels[i * 4 + 1] = 59;
    pixels[i * 4 + 2] = 48;
    pixels[i * 4 + 3] = 255;
  }

  const nBins = 18;
  const oriBins = orientationHistogram(gx, gy, mag, nBins, oriThresh);
  const oriSum = Array.from(oriBins).reduce((a, b) => a + b, 0) || 1;
  const binWidth = 180 / nBins;
  let dominantIdx = 0;
  for (let i = 1; i < nBins; i++) if (oriBins[i] > oriBins[dominantIdx]) dominantIdx = i;
  const texture = Array.from(oriBins).map((v, i) => ({
    label: `${Math.round(i * binWidth)}–${Math.round((i + 1) * binWidth)}°`,
    fraction: v / oriSum,
  }));

  const histBins = 12;
  const min = diam[0];
  const max = diam[diam.length - 1];
  const binW = Math.max(1e-6, (max - min) / histBins);
  const histogram: HistogramBin[] = Array.from({ length: histBins }, (_, i) => ({
    bin_start: min + i * binW,
    bin_end: min + (i + 1) * binW,
    count: 0,
    area_fraction: 0,
  }));
  for (const d of diam) {
    let b = Math.floor((d - min) / binW);
    if (b >= histBins) b = histBins - 1;
    if (b < 0) b = 0;
    histogram[b].count += 1;
  }
  for (const bin of histogram) bin.area_fraction = bin.count / diam.length;

  const unit = userPxSize ? "µm" : "px";
  const report = sizeReport(diam, topN, unit);
  const n = diam.length;

  return {
    kind: "fracture",
    summary: {
      facet_count: n,
      median_ecd: percentile(diam, 0.5),
      mean_ecd: diam.reduce((a, b) => a + b, 0) / n,
      p10: percentile(diam, 0.1),
      p90: percentile(diam, 0.9),
      dominant_angle: `${Math.round(dominantIdx * binWidth)}~${Math.round((dominantIdx + 1) * binWidth)}°`,
      unit,
      image_width: ow,
      image_height: oh,
      scale_um_per_px: userPxSize,
      method: "watershed-facets",
    },
    histogram,
    texture,
    facets: report.top.map((ecd, i) => ({ rank: i + 1, ecd })),
    report_csv: report.csv,
    overlay_png_base64: overlayToBase64(w, h, pixels),
    notes: [
      "facet 크기는 밝기(=지형 대리) 기반 근사이며 최소 셀 간격에 결과가 민감합니다.",
      "실제 결정립 크기(EBSD/IPF)와는 별도로 비교·검증하세요.",
    ],
  };
}
