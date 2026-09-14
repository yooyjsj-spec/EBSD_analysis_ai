// Automatic scale-bar detection.
//
// Microscope images carry a scale bar (usually bottom-right, often inside a
// data banner) made of a horizontal line with tick marks. Reading µm/pixel by
// hand is error prone, so this module measures the bar in pixels and lets the
// caller convert it with a single physical length.

const MAX_DETECT_EDGE = 3000;

export type ScaleBarDetection = {
  /** Pixel length actually measured, in ORIGINAL image pixels. */
  spanPx: number;
  /** Full detected bar length in original pixels. */
  barLengthPx: number;
  /** Number of tick marks found on the bar. */
  tickCount: number;
  /** Divisions between ticks (tickCount - 1), 0 when no ticks were found. */
  divisions: number;
  /** Whether spanPx came from tick marks or from the bar ends. */
  measuredFrom: "ticks" | "bar";
  polarity: "bright" | "dark";
  /** Where the bar sits, as a fraction of image size. */
  position: { x: number; y: number };
  imageWidth: number;
  imageHeight: number;
  previewPngBase64: string;
};

type Loaded = {
  data: Uint8ClampedArray;
  w: number;
  h: number;
  ow: number;
  oh: number;
  scale: number;
};

async function loadFull(file: File): Promise<Loaded> {
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
    const scale = Math.min(1, MAX_DETECT_EDGE / Math.max(ow, oh));
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

export type BarCandidate = {
  y: number;
  top: number;
  bottom: number;
  x0: number;
  x1: number;
  length: number;
  score: number;
};

function foregroundMask(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  polarity: "bright" | "dark",
): Uint8Array {
  const mask = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < mask.length; i++, p += 4) {
    const gray = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
    mask[i] = polarity === "bright" ? (gray > 190 ? 1 : 0) : gray < 60 ? 1 : 0;
  }
  return mask;
}

/** Longest horizontal run of foreground pixels in one row. */
function longestRun(mask: Uint8Array, w: number, y: number): { start: number; len: number } {
  let best = { start: 0, len: 0 };
  let runStart = -1;
  const base = y * w;
  for (let x = 0; x < w; x++) {
    if (mask[base + x]) {
      if (runStart < 0) runStart = x;
    } else if (runStart >= 0) {
      const len = x - runStart;
      if (len > best.len) best = { start: runStart, len };
      runStart = -1;
    }
  }
  if (runStart >= 0) {
    const len = w - runStart;
    if (len > best.len) best = { start: runStart, len };
  }
  return best;
}

function findBar(mask: Uint8Array, w: number, h: number): BarCandidate | null {
  const yStart = Math.floor(h * 0.55);
  const minLen = Math.max(12, Math.round(w * 0.03));
  const maxLen = Math.round(w * 0.85);

  type Row = { y: number; start: number; len: number };
  const rows: Row[] = [];
  for (let y = yStart; y < h; y++) {
    const run = longestRun(mask, w, y);
    if (run.len >= minLen && run.len <= maxLen) rows.push({ y, start: run.start, len: run.len });
  }
  if (rows.length === 0) return null;

  // Group vertically adjacent rows that overlap horizontally: the bar is a
  // short stack of nearly identical runs.
  const groups: Row[][] = [];
  let current: Row[] = [];
  for (const row of rows) {
    const prev = current[current.length - 1];
    const contiguous =
      prev &&
      row.y - prev.y <= 1 &&
      Math.abs(row.start - prev.start) <= Math.max(3, prev.len * 0.1) &&
      Math.abs(row.len - prev.len) <= Math.max(3, prev.len * 0.15);
    if (contiguous) current.push(row);
    else {
      if (current.length) groups.push(current);
      current = [row];
    }
  }
  if (current.length) groups.push(current);

  let best: BarCandidate | null = null;
  for (const group of groups) {
    const longest = group.reduce((a, b) => (b.len > a.len ? b : a));
    const top = group[0].y;
    const bottom = group[group.length - 1].y;
    const thickness = bottom - top + 1;
    // A scale bar is a thin, wide line. Skip thick blobs.
    if (thickness > Math.max(12, longest.len * 0.35)) continue;
    const x0 = longest.start;
    const x1 = longest.start + longest.len - 1;
    // A real bar stands alone: just above and below it there is mostly
    // background, broken only by the narrow tick marks. A bright patch of a
    // data banner fails this because its neighbourhood is bright too.
    if (surroundingForeground(mask, w, h, top, bottom, x0, x1) > 0.5) continue;

    const cx = (x0 + x1) / 2 / w;
    const cy = (top + bottom) / 2 / h;
    // Prefer long bars, low in the frame, toward the right.
    const score = longest.len / w + cy * 0.35 + cx * 0.2;
    if (!best || score > best.score) {
      best = { y: Math.round((top + bottom) / 2), top, bottom, x0, x1, length: longest.len, score };
    }
  }
  return best;
}

function surroundingForeground(
  mask: Uint8Array,
  w: number,
  h: number,
  top: number,
  bottom: number,
  x0: number,
  x1: number,
): number {
  const rows = [top - 3, top - 2, bottom + 2, bottom + 3].filter((y) => y >= 0 && y < h);
  if (rows.length === 0) return 1;
  let fg = 0;
  for (const y of rows) for (let x = x0; x <= x1; x++) if (mask[y * w + x]) fg += 1;
  return fg / (rows.length * (x1 - x0 + 1));
}

/** Tick marks stick out vertically beyond the bar line. */
function findTicks(mask: Uint8Array, w: number, h: number, bar: BarCandidate): number[] {
  const thickness = bar.bottom - bar.top + 1;
  const reach = Math.max(6, thickness * 4);
  const top = Math.max(0, bar.top - reach);
  const bottom = Math.min(h - 1, bar.bottom + reach);

  const extents: number[] = [];
  for (let x = bar.x0; x <= bar.x1; x++) {
    let count = 0;
    for (let y = top; y <= bottom; y++) if (mask[y * w + x]) count += 1;
    extents.push(count);
  }
  const threshold = thickness + Math.max(2, Math.round(thickness * 0.8));

  const centers: number[] = [];
  let runStart = -1;
  for (let i = 0; i < extents.length; i++) {
    const isTick = extents[i] >= threshold;
    if (isTick) {
      if (runStart < 0) runStart = i;
    } else if (runStart >= 0) {
      centers.push(bar.x0 + (runStart + i - 1) / 2);
      runStart = -1;
    }
  }
  if (runStart >= 0) centers.push(bar.x0 + (runStart + extents.length - 1) / 2);

  // Merge ticks that are unrealistically close together.
  const minGap = Math.max(2, bar.length * 0.02);
  const merged: number[] = [];
  for (const c of centers) {
    if (merged.length === 0 || c - merged[merged.length - 1] >= minGap) merged.push(c);
    else merged[merged.length - 1] = (merged[merged.length - 1] + c) / 2;
  }
  return merged;
}

function buildPreview(
  loaded: Loaded,
  bar: BarCandidate,
  ticks: number[],
): string {
  const { data, w, h } = loaded;
  const padX = Math.max(16, Math.round(bar.length * 0.12));
  const padY = Math.max(14, (bar.bottom - bar.top + 1) * 6);
  const x0 = Math.max(0, bar.x0 - padX);
  const x1 = Math.min(w - 1, bar.x1 + padX);
  const y0 = Math.max(0, bar.top - padY);
  const y1 = Math.min(h - 1, bar.bottom + padY);
  const cw = x1 - x0 + 1;
  const ch = y1 - y0 + 1;

  const crop = document.createElement("canvas");
  crop.width = cw;
  crop.height = ch;
  const cctx = crop.getContext("2d");
  if (!cctx) throw new Error("Canvas를 사용할 수 없습니다.");
  const imageData = cctx.createImageData(cw, ch);
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const src = ((y + y0) * w + (x + x0)) * 4;
      const dst = (y * cw + x) * 4;
      imageData.data[dst] = data[src];
      imageData.data[dst + 1] = data[src + 1];
      imageData.data[dst + 2] = data[src + 2];
      imageData.data[dst + 3] = 255;
    }
  }
  cctx.putImageData(imageData, 0, 0);

  // Upscale small crops so the annotation is readable.
  const zoom = Math.min(4, Math.max(1, Math.round(520 / cw)));
  const out = document.createElement("canvas");
  out.width = cw * zoom;
  out.height = ch * zoom;
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("Canvas를 사용할 수 없습니다.");
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(crop, 0, 0, out.width, out.height);

  ctx.lineWidth = Math.max(1, zoom);
  ctx.strokeStyle = "#35d0ff";
  ctx.strokeRect(
    (bar.x0 - x0) * zoom,
    (bar.top - y0) * zoom - zoom,
    bar.length * zoom,
    (bar.bottom - bar.top + 1) * zoom + 2 * zoom,
  );

  ctx.strokeStyle = "#ffd040";
  for (const t of ticks) {
    const x = (t - x0) * zoom + zoom / 2;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, out.height);
    ctx.stroke();
  }
  return out.toDataURL("image/png").split(",")[1];
}

type Located = { bar: BarCandidate; ticks: number[]; polarity: "bright" | "dark" };

/**
 * DOM-free core: locate the bar and its ticks in raw RGBA pixels. Both
 * bright-on-dark and dark-on-bright bars are scored, and the better one wins.
 */
export function locateScaleBar(data: Uint8ClampedArray, w: number, h: number): Located | null {
  let best: Located | null = null;
  let bestScore = -Infinity;
  for (const polarity of ["bright", "dark"] as const) {
    const mask = foregroundMask(data, w, h, polarity);
    const bar = findBar(mask, w, h);
    if (!bar) continue;
    const ticks = findTicks(mask, w, h, bar);
    const score = bar.score + (ticks.length >= 3 ? 0.6 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = { bar, ticks, polarity };
    }
  }
  return best;
}

export async function detectScaleBar(file: File): Promise<ScaleBarDetection> {
  const loaded = await loadFull(file);
  const { w, h, ow, oh, scale } = loaded;

  const located = locateScaleBar(loaded.data, w, h);
  if (!located) {
    throw new Error(
      "스케일바를 찾지 못했습니다. 이미지 하단에 스케일바가 보이는지 확인하거나 µm/pixel을 직접 입력하세요.",
    );
  }
  const { bar, ticks, polarity } = located;

  const useTicks = ticks.length >= 3;
  const spanDetect = useTicks ? ticks[ticks.length - 1] - ticks[0] : bar.length;
  const toOriginal = 1 / Math.max(scale, 1e-9);

  return {
    spanPx: spanDetect * toOriginal,
    barLengthPx: bar.length * toOriginal,
    tickCount: ticks.length,
    divisions: useTicks ? ticks.length - 1 : 0,
    measuredFrom: useTicks ? "ticks" : "bar",
    polarity,
    position: { x: (bar.x0 + bar.x1) / 2 / w, y: bar.y / h },
    imageWidth: ow,
    imageHeight: oh,
    previewPngBase64: buildPreview(loaded, bar, ticks),
  };
}
