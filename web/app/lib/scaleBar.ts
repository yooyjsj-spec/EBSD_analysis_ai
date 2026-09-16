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
  /** Physical length read from the "500µm" (or similar) label, if any. */
  labelUm: number | null;
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
  threshold = 190,
): Uint8Array {
  const mask = new Uint8Array(w * h);
  const darkCut = Math.min(70, 255 - threshold);
  for (let i = 0, p = 0; i < mask.length; i++, p += 4) {
    const gray = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
    mask[i] = polarity === "bright" ? (gray > threshold ? 1 : 0) : gray < darkCut ? 1 : 0;
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

function grayAt(data: Uint8ClampedArray, i: number): number {
  const p = i * 4;
  return 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
}

/** Dark (or light) data banner sitting on the bottom of a micrograph. */
function bannerYRange(data: Uint8ClampedArray, w: number, h: number, polarity: "bright" | "dark"): { y0: number; y1: number } | null {
  const isBannerRow = (y: number) => {
    let bg = 0;
    for (let x = 0; x < w; x++) {
      const g = grayAt(data, y * w + x);
      if (polarity === "bright" ? g < 70 : g > 185) bg += 1;
    }
    return bg / w > 0.55;
  };
  let y1 = h - 1;
  while (y1 > 0 && !isBannerRow(y1)) y1 -= 1;
  if (y1 < 8) return null;
  let y0 = y1;
  while (y0 > 0 && isBannerRow(y0 - 1)) y0 -= 1;
  if (y1 - y0 + 1 < 8) return null;
  return { y0, y1 };
}

/**
 * Longest nearly-arithmetic subsequence. Scale-bar ticks are equally spaced;
 * letters in "KOOKMIN 10.00kV" are not.
 */
export function regularTickSequence(xs: number[]): number[] {
  const pts = [...xs].sort((a, b) => a - b);
  if (pts.length < 5) return [];
  let best: number[] = [];
  const consider = (seq: number[]) => {
    if (seq.length < 5) return;
    const prefer11 = seq.length === 11 || seq.length === 6 || seq.length === 21;
    const bestPrefer = best.length === 11 || best.length === 6 || best.length === 21;
    if (seq.length === 11 && best.length !== 11) {
      best = seq;
      return;
    }
    if (prefer11 && bestPrefer && seq.length === best.length) {
      if (seq[0] > best[0]) best = seq;
      return;
    }
    if (seq.length > best.length) best = seq;
  };
  for (let i = 0; i < pts.length - 4; i++) {
    for (let j = i + 1; j < Math.min(i + 6, pts.length); j++) {
      const gap = pts[j] - pts[i];
      if (gap < 8 || gap > Math.max(40, pts[pts.length - 1] * 0.35)) continue;
      const seq = [pts[i]];
      let next = pts[i] + gap;
      let k = j;
      while (k < pts.length) {
        const slop = gap * 0.18;
        let found = -1;
        let bestDist = slop;
        for (let t = k; t < pts.length && pts[t] <= next + slop; t++) {
          const d = Math.abs(pts[t] - next);
          if (d <= bestDist) {
            bestDist = d;
            found = t;
          }
        }
        if (found < 0) break;
        seq.push(pts[found]);
        next = pts[found] + gap;
        k = found + 1;
      }
      consider(seq);
    }
  }
  return best;
}

type Ruler = { ticks: number[]; y: number; top: number; bottom: number; score: number };

function isolatedCenters(heights: Uint16Array, minH: number, maxH: number): number[] {
  const centers: number[] = [];
  let i = 0;
  while (i < heights.length) {
    if (heights[i] >= minH && heights[i] <= maxH) {
      let j = i;
      while (j + 1 < heights.length && heights[j + 1] >= minH && heights[j + 1] <= maxH) j += 1;
      if (j - i + 1 <= 4) centers.push((i + j) / 2);
      i = j + 1;
    } else i += 1;
  }
  return centers;
}

/** TESCAN-style ruler: 11 isolated ticks, no connecting bar. */
function scanRuler(mask: Uint8Array, w: number, h: number, bandTop: number, bandBot: number): Ruler | null {
  if (bandBot - bandTop < 4) return null;

  const heights = new Uint16Array(w);
  const firstY = new Int16Array(w).fill(-1);
  const lastY = new Int16Array(w).fill(-1);
  for (let x = 0; x < w; x++) {
    let best = 0;
    let run = 0;
    let runStart = bandTop;
    for (let y = bandTop; y <= bandBot; y++) {
      if (mask[y * w + x]) {
        if (run === 0) runStart = y;
        run += 1;
        if (run > best) {
          best = run;
          firstY[x] = runStart;
          lastY[x] = y;
        }
      } else run = 0;
    }
    heights[x] = best;
  }

  const minH = 3;
  const maxH = Math.min(16, Math.max(8, bandBot - bandTop + 1));
  const raw = isolatedCenters(heights, minH, maxH);
  const ticks = regularTickSequence(raw);
  if (ticks.length < 5) return null;
  const span = ticks[ticks.length - 1] - ticks[0];
  if (span < 20 || span > w * 0.7) return null;

  let top = bandBot;
  let bottom = bandTop;
  for (const t of ticks) {
    const x = Math.round(t);
    if (x >= 0 && x < w && firstY[x] >= 0) top = Math.min(top, firstY[x]);
    if (x >= 0 && x < w && lastY[x] >= 0) bottom = Math.max(bottom, lastY[x]);
  }
  const divisions = ticks.length - 1;
  const prefer = divisions === 10 ? 1.6 : divisions === 5 ? 0.9 : divisions === 20 ? 0.7 : 0.2;
  const score = ticks.length / 15 + prefer + (ticks[0] / w) * 0.35;
  return { ticks, y: Math.round((top + bottom) / 2), top, bottom, score };
}

function findRegularRuler(mask: Uint8Array, w: number, h: number, y0: number, y1: number): Ruler | null {
  const top = Math.max(0, y0);
  const bot = Math.min(h - 1, y1);
  // Ticks sit on the top edge of the data banner; scanning the whole banner
  // also picks up "KOOKMIN 10.00kV" letter stems on the left.
  const edge = scanRuler(mask, w, h, top, Math.min(bot, top + 10));
  const full = scanRuler(mask, w, h, top, bot);
  if (edge && full) return edge.ticks.length === 11 || edge.score >= full.score ? edge : full;
  return edge || full;
}

type Glyph = { x0: number; y0: number; x1: number; y1: number };

function connectedGlyphs(mask: Uint8Array, w: number, h: number, x0: number, x1: number, y0: number, y1: number): Glyph[] {
  const seen = new Uint8Array(w * h);
  const glyphs: Glyph[] = [];
  const stack: number[] = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const start = y * w + x;
      if (!mask[start] || seen[start]) continue;
      stack.length = 0;
      stack.push(start);
      seen[start] = 1;
      let gx0 = x,
        gx1 = x,
        gy0 = y,
        gy1 = y,
        area = 0;
      while (stack.length) {
        const i = stack.pop()!;
        area += 1;
        const cx = i % w;
        const cy = (i / w) | 0;
        if (cx < gx0) gx0 = cx;
        if (cx > gx1) gx1 = cx;
        if (cy < gy0) gy0 = cy;
        if (cy > gy1) gy1 = cy;
        const nbs = [
          cx > 0 ? i - 1 : -1,
          cx + 1 < w ? i + 1 : -1,
          cy > 0 ? i - w : -1,
          cy + 1 < h ? i + w : -1,
        ];
        for (const n of nbs) {
          if (n < 0 || n >= w * h || seen[n] || !mask[n]) continue;
          const nx = n % w;
          const ny = (n / w) | 0;
          if (nx < x0 || nx > x1 || ny < y0 || ny > y1) continue;
          seen[n] = 1;
          stack.push(n);
        }
      }
      const bw = gx1 - gx0 + 1;
      const bh = gy1 - gy0 + 1;
      if (bh >= 8 && bh <= 40 && area >= 12 && bw <= bh * 1.4) glyphs.push({ x0: gx0, y0: gy0, x1: gx1, y1: gy1 });
    }
  }
  glyphs.sort((a, b) => a.x0 - b.x0);
  return glyphs;
}

function glyphHoles(mask: Uint8Array, w: number, g: Glyph): number {
  const bw = g.x1 - g.x0 + 1;
  const bh = g.y1 - g.y0 + 1;
  const inv = new Uint8Array(bw * bh);
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      inv[y * bw + x] = mask[(g.y0 + y) * w + (g.x0 + x)] ? 0 : 1;
    }
  }
  const fill = new Uint8Array(bw * bh);
  const stack: number[] = [];
  const push = (x: number, y: number) => {
    const i = y * bw + x;
    if (inv[i] && !fill[i]) {
      fill[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < bw; x++) {
    push(x, 0);
    push(x, bh - 1);
  }
  for (let y = 0; y < bh; y++) {
    push(0, y);
    push(bw - 1, y);
  }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % bw;
    const y = (i / bw) | 0;
    if (x > 0) push(x - 1, y);
    if (x + 1 < bw) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y + 1 < bh) push(x, y + 1);
  }
  for (let i = 0; i < inv.length; i++) if (inv[i] && !fill[i]) return 1;
  return 0;
}

function cellInk(mask: Uint8Array, w: number, g: Glyph, gx: number, gy: number): number {
  const bw = g.x1 - g.x0 + 1;
  const bh = g.y1 - g.y0 + 1;
  const xs = g.x0 + Math.floor((gx * bw) / 3);
  const xe = g.x0 + Math.floor(((gx + 1) * bw) / 3);
  const ys = g.y0 + Math.floor((gy * bh) / 3);
  const ye = g.y0 + Math.floor(((gy + 1) * bh) / 3);
  if (xe <= xs || ye <= ys) return 0;
  let n = 0;
  let fg = 0;
  for (let y = ys; y < ye; y++) {
    for (let x = xs; x < xe; x++) {
      n += 1;
      if (mask[y * w + x]) fg += 1;
    }
  }
  return n ? fg / n : 0;
}

function classifyDigit(mask: Uint8Array, w: number, g: Glyph): string | null {
  const bw = g.x1 - g.x0 + 1;
  const bh = g.y1 - g.y0 + 1;
  const aspect = bw / bh;
  if (aspect > 1.2) return null;
  const holes = glyphHoles(mask, w, g);
  const c = (x: number, y: number) => cellInk(mask, w, g, x, y);
  if (aspect < 0.38 && holes === 0) return "1";
  if (holes === 1 && c(1, 1) < 0.25 && c(0, 1) > 0.2 && c(2, 1) > 0.2) {
    if (c(0, 2) > 0.5 && c(2, 0) < 0.22) return "6";
    if (c(2, 0) > 0.5 && c(0, 2) < 0.22) return "9";
    return "0";
  }
  if (holes === 2) return "8";
  if (holes === 0) {
    if (c(0, 0) > 0.45 && c(2, 0) < 0.45 && c(1, 1) > 0.2) return "5";
    if (c(0, 0) > 0.4 && c(2, 0) > 0.4 && c(2, 2) > 0.35 && c(0, 2) < 0.35) return "2";
    if (c(0, 0) > 0.4 && c(2, 0) > 0.4 && c(2, 1) > 0.35 && c(0, 1) < 0.25) return "3";
    if (c(0, 0) > 0.5 && c(2, 0) > 0.5 && c(1, 2) < 0.2) return "7";
    if (c(0, 0) > 0.4 && c(2, 0) < 0.45) return "5";
  }
  return null;
}

const TYPICAL_UM = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000];

/** Read a number like 500 from "500µm" / "20 um" / "1mm" in the data banner. */
export function readScaleLabelUm(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  polarity: "bright" | "dark",
  aroundX: number,
): number | null {
  const mask = foregroundMask(data, w, h, polarity, 170);
  const banner = bannerYRange(data, w, h, polarity);
  const y0 = banner ? banner.y0 : Math.floor(h * 0.7);
  const y1 = banner ? banner.y1 : h - 1;
  const x0 = Math.max(0, Math.floor(Math.max(aroundX, w * 0.5)));
  const x1 = w - 1;
  const glyphs = connectedGlyphs(mask, w, h, x0, x1, y0, y1);
  const groups: string[] = [];
  let cur = "";
  for (const g of glyphs) {
    const d = classifyDigit(mask, w, g);
    if (d) cur += d;
    else if (cur) {
      groups.push(cur);
      cur = "";
    }
  }
  if (cur) groups.push(cur);

  const blob = groups.join("");
  let best: number | null = null;
  for (let i = 0; i < blob.length; i++) {
    for (let j = i + 1; j <= blob.length; j++) {
      const n = Number(blob.slice(i, j));
      if (!TYPICAL_UM.includes(n) || n < 5) continue;
      if (best === null || String(n).length > String(best).length) best = n;
    }
  }
  return best;
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
  const regular = regularTickSequence(merged);
  return regular.length >= 5 ? regular : merged;
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

type Located = {
  bar: BarCandidate;
  ticks: number[];
  polarity: "bright" | "dark";
  labelUm: number | null;
};

/**
 * DOM-free core: locate the bar and its ticks in raw RGBA pixels. Isolated
 * equally-spaced ticks (TESCAN-style, no connecting bar) are preferred over a
 * long line that starts at the left of the data banner.
 */
export function locateScaleBar(data: Uint8ClampedArray, w: number, h: number): Located | null {
  let best: Located | null = null;
  let bestScore = -Infinity;
  for (const polarity of ["bright", "dark"] as const) {
    const mask = foregroundMask(data, w, h, polarity);
    const banner = bannerYRange(data, w, h, polarity);
    const searchTop = banner ? Math.max(0, banner.y0 - 2) : Math.floor(h * 0.5);
    const searchBot = banner ? banner.y1 : h - 1;
    const ruler = findRegularRuler(mask, w, h, searchTop, searchBot);
    const bar = findBar(mask, w, h);
    const barTicks = bar ? findTicks(mask, w, h, bar) : [];

    if (ruler) {
      const span = ruler.ticks[ruler.ticks.length - 1] - ruler.ticks[0];
      const synthetic: BarCandidate = {
        y: ruler.y,
        top: ruler.top,
        bottom: ruler.bottom,
        x0: Math.round(ruler.ticks[0]),
        x1: Math.round(ruler.ticks[ruler.ticks.length - 1]),
        length: Math.max(1, Math.round(span)),
        score: ruler.score,
      };
      const score = ruler.score + 1.2;
      if (score > bestScore) {
        bestScore = score;
        const aroundX = synthetic.x0;
        best = {
          bar: synthetic,
          ticks: ruler.ticks,
          polarity,
          labelUm: readScaleLabelUm(data, w, h, polarity, aroundX),
        };
      }
    }

    if (bar) {
      const score = bar.score + (barTicks.length >= 3 ? 0.6 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = {
          bar,
          ticks: barTicks,
          polarity,
          labelUm: readScaleLabelUm(data, w, h, polarity, bar.x0),
        };
      }
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
  const { bar, ticks, polarity, labelUm } = located;

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
    labelUm,
    position: { x: (bar.x0 + bar.x1) / 2 / w, y: bar.y / h },
    imageWidth: ow,
    imageHeight: oh,
    previewPngBase64: buildPreview(loaded, bar, ticks),
  };
}
