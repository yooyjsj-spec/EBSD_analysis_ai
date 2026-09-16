// Browser-side approximations of the SEM / IPF / KAM analyzers.
// These run entirely on the client (Canvas) so the app can be served as a
// static site (e.g. GitHub Pages) without the Python backend.

import type { IpfResult, KamResult, SemResult } from "./types";

const MAX_EDGE = 1000;

type Loaded = {
  data: Uint8ClampedArray;
  w: number;
  h: number;
  ow: number;
  oh: number;
  scale: number;
};

async function loadImageData(file: File, maxEdge = MAX_EDGE): Promise<Loaded> {
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
    const scale = Math.min(1, maxEdge / Math.max(ow, oh));
    const w = Math.max(1, Math.round(ow * scale));
    const h = Math.max(1, Math.round(oh * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Canvas를 사용할 수 없습니다.");
    ctx.drawImage(img, 0, 0, w, h);
    const imageData = ctx.getImageData(0, 0, w, h);
    return { data: imageData.data, w, h, ow, oh, scale };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function toGray(data: Uint8ClampedArray, w: number, h: number): Float32Array {
  const gray = new Float32Array(w * h);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    gray[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
  }
  return gray;
}

// Region growing on RGB with a color-distance threshold (4-connectivity).
function regionGrow(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  threshold: number,
): { labels: Int32Array; count: number } {
  const n = w * h;
  const labels = new Int32Array(n).fill(0);
  const stack = new Int32Array(n);
  const t2 = threshold * threshold;
  let current = 0;
  for (let start = 0; start < n; start++) {
    if (labels[start] !== 0) continue;
    current += 1;
    const sp = start * 4;
    const sr = data[sp];
    const sg = data[sp + 1];
    const sb = data[sp + 2];
    let top = 0;
    labels[start] = current;
    stack[top++] = start;
    while (top > 0) {
      const p = stack[--top];
      const px = p % w;
      const py = (p / w) | 0;
      // 4 neighbors
      const neighbors = [
        px > 0 ? p - 1 : -1,
        px < w - 1 ? p + 1 : -1,
        py > 0 ? p - w : -1,
        py < h - 1 ? p + w : -1,
      ];
      for (let k = 0; k < 4; k++) {
        const q = neighbors[k];
        if (q < 0 || labels[q] !== 0) continue;
        const qp = q * 4;
        const dr = data[qp] - sr;
        const dg = data[qp + 1] - sg;
        const db = data[qp + 2] - sb;
        if (dr * dr + dg * dg + db * db <= t2) {
          labels[q] = current;
          stack[top++] = q;
        }
      }
    }
  }
  return { labels, count: current };
}

function dilateMask4(mask: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(mask);
  const n = w * h;
  for (let p = 0; p < n; p++) {
    if (!mask[p]) continue;
    const x = p % w;
    const y = (p / w) | 0;
    if (x > 0) out[p - 1] = 1;
    if (x < w - 1) out[p + 1] = 1;
    if (y > 0) out[p - w] = 1;
    if (y < h - 1) out[p + w] = 1;
  }
  return out;
}

// --- Grain segmentation for SEM: marker-controlled watershed on a smoothed
// gradient. A flat threshold on edge strength (as used for slip-trace /
// dislocation-contrast detection) is *not* reused for grain walls: strong
// internal features (slip bands, scratches, channeling contrast) would slice
// a single grain into many fragments, while faint boundaries would leave gaps
// that let neighboring grains bleed together. Watershed is robust to both,
// which is why it's also what the Python backend uses for SEM segmentation.

function boxBlur(gray: Float32Array, w: number, h: number, radius: number): Float32Array {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const span = radius * 2 + 1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    for (let x = -radius; x <= radius; x++) sum += gray[row + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = sum / span;
      const addX = Math.min(w - 1, x + radius + 1);
      const subX = Math.max(0, x - radius);
      sum += gray[row + addX] - gray[row + subX];
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -radius; y <= radius; y++) sum += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / span;
      const addY = Math.min(h - 1, y + radius + 1);
      const subY = Math.max(0, y - radius);
      sum += tmp[addY * w + x] - tmp[subY * w + x];
    }
  }
  return out;
}

function sobelMagnitude(gray: Float32Array, w: number, h: number): Float32Array {
  const mag = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx =
        -gray[i - w - 1] - 2 * gray[i - 1] - gray[i + w - 1] + gray[i - w + 1] + 2 * gray[i + 1] + gray[i + w + 1];
      const gy =
        -gray[i - w - 1] - 2 * gray[i - w] - gray[i - w + 1] + gray[i + w - 1] + 2 * gray[i + w] + gray[i + w + 1];
      mag[i] = Math.sqrt(gx * gx + gy * gy);
    }
  }
  return mag;
}

function percentileValue(values: Float32Array, q: number): number {
  const sorted = Float32Array.from(values).sort();
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((q / 100) * sorted.length)));
  return sorted[idx];
}

function connectedComponentsMask(mask: Uint8Array, w: number, h: number): { labels: Int32Array; count: number } {
  const n = w * h;
  const labels = new Int32Array(n).fill(0);
  const stack = new Int32Array(n);
  let current = 0;
  for (let start = 0; start < n; start++) {
    if (!mask[start] || labels[start] !== 0) continue;
    current += 1;
    let top = 0;
    labels[start] = current;
    stack[top++] = start;
    while (top > 0) {
      const p = stack[--top];
      const x = p % w;
      const y = (p / w) | 0;
      const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
      for (let k = 0; k < 4; k++) {
        const q = nb[k];
        if (q < 0 || !mask[q] || labels[q] !== 0) continue;
        labels[q] = current;
        stack[top++] = q;
      }
    }
  }
  return { labels, count: current };
}

const WATERSHED_LEVELS = 256;

/** Marker-controlled watershed: floods outward from `markers` in order of ascending gradient. */
function watershedGrow(mag: Float32Array, w: number, h: number, markers: Int32Array): Int32Array {
  const n = w * h;
  const labels = Int32Array.from(markers);
  let minV = Infinity;
  let maxV = -Infinity;
  for (let i = 0; i < n; i++) {
    if (mag[i] < minV) minV = mag[i];
    if (mag[i] > maxV) maxV = mag[i];
  }
  const range = maxV - minV || 1;
  const level = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    level[i] = Math.min(WATERSHED_LEVELS - 1, Math.floor(((mag[i] - minV) / range) * (WATERSHED_LEVELS - 1)));
  }

  const buckets: number[][] = Array.from({ length: WATERSHED_LEVELS }, () => []);
  const queued = new Uint8Array(n);
  for (let p = 0; p < n; p++) {
    if (labels[p] !== 0) continue;
    const x = p % w;
    const y = (p / w) | 0;
    const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
    for (const q of nb) {
      if (q >= 0 && labels[q] > 0) {
        buckets[level[p]].push(p);
        queued[p] = 1;
        break;
      }
    }
  }

  for (let lvl = 0; lvl < WATERSHED_LEVELS; lvl++) {
    const bucket = buckets[lvl];
    for (let idx = 0; idx < bucket.length; idx++) {
      const p = bucket[idx];
      if (labels[p] !== 0) continue;
      const x = p % w;
      const y = (p / w) | 0;
      const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
      let assigned = 0;
      for (const q of nb) {
        if (q >= 0 && labels[q] > 0) {
          assigned = labels[q];
          break;
        }
      }
      if (assigned === 0) continue;
      labels[p] = assigned;
      for (const q of nb) {
        if (q >= 0 && labels[q] === 0 && !queued[q]) {
          queued[q] = 1;
          const lv = level[q];
          if (lv <= lvl) bucket.push(q);
          else buckets[lv].push(q);
        }
      }
    }
  }
  return labels;
}

function regionAreas(labels: Int32Array): Map<number, number> {
  const areas = new Map<number, number>();
  for (let i = 0; i < labels.length; i++) {
    const l = labels[i];
    if (l <= 0) continue;
    areas.set(l, (areas.get(l) ?? 0) + 1);
  }
  return areas;
}

/** Drops regions below `minArea` and grows the survivors to fill the gaps (BFS, like skimage's expand_labels). */
function absorbSmallRegions(labels: Int32Array, w: number, h: number, minArea: number): Int32Array {
  const areas = regionAreas(labels);
  const out = Int32Array.from(labels);
  let removed = false;
  let kept = false;
  for (let i = 0; i < out.length; i++) {
    if (out[i] > 0) {
      if ((areas.get(out[i]) ?? 0) < minArea) {
        out[i] = 0;
        removed = true;
      } else {
        kept = true;
      }
    }
  }
  if (!removed || !kept) return out;

  const n = w * h;
  const visited = new Uint8Array(n);
  let frontier: number[] = [];
  for (let p = 0; p < n; p++) {
    if (out[p] > 0) {
      visited[p] = 1;
      frontier.push(p);
    }
  }
  while (frontier.length > 0) {
    const next: number[] = [];
    for (const p of frontier) {
      const label = out[p];
      const x = p % w;
      const y = (p / w) | 0;
      const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
      for (const q of nb) {
        if (q >= 0 && !visited[q] && out[q] === 0) {
          out[q] = label;
          visited[q] = 1;
          next.push(q);
        }
      }
    }
    frontier = next;
  }
  return out;
}

/** Tiny union-find used to merge watershed catchment basins that turn out to have near-identical mean brightness. */
class UnionFind {
  parent: Int32Array;
  constructor(n: number) {
    this.parent = new Int32Array(n);
    for (let i = 0; i < n; i++) this.parent[i] = i;
  }
  find(x: number): number {
    while (this.parent[x] !== x) {
      this.parent[x] = this.parent[this.parent[x]];
      x = this.parent[x];
    }
    return x;
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[ra] = rb;
  }
}

function meansByLabel(gray: Float32Array, labels: Int32Array, maxLabel: number): Float64Array {
  const sums = new Float64Array(maxLabel + 1);
  const counts = new Int32Array(maxLabel + 1);
  for (let i = 0; i < labels.length; i++) {
    const l = labels[i];
    if (l <= 0) continue;
    sums[l] += gray[i];
    counts[l] += 1;
  }
  const means = new Float64Array(maxLabel + 1);
  for (let l = 1; l <= maxLabel; l++) means[l] = counts[l] ? sums[l] / counts[l] : 0;
  return means;
}

/** Merges adjacent regions whose mean gray level differs by less than `threshold` (a thresholded RAG cut). */
function ragMergeByMean(labels: Int32Array, w: number, h: number, means: Float64Array, threshold: number): Int32Array {
  const uf = new UnionFind(means.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      const l = labels[p];
      if (l <= 0) continue;
      if (x < w - 1) {
        const r = labels[p + 1];
        if (r > 0 && r !== l && Math.abs(means[l] - means[r]) < threshold) uf.union(l, r);
      }
      if (y < h - 1) {
        const d = labels[p + w];
        if (d > 0 && d !== l && Math.abs(means[l] - means[d]) < threshold) uf.union(l, d);
      }
    }
  }
  const out = new Int32Array(labels.length);
  for (let i = 0; i < labels.length; i++) out[i] = labels[i] > 0 ? uf.find(labels[i]) : 0;
  return out;
}

const GRAIN_MERGE_THRESHOLD = 11;

/**
 * Grain segmentation for SEM: watershed the gradient (from markers seeded in
 * low-gradient basins) and then merge the resulting catchment basins by mean
 * brightness. The watershed alone over-segments badly — per-pixel sensor
 * noise breaks up what should be one flat grain interior into hundreds of
 * tiny separate basins, and slip/dislocation contrast adds more — but those
 * spurious basins share almost the same mean gray level as their neighbors,
 * so a mean-intensity region merge (mirrors skimage's RAG mean-color cut,
 * used server-side) fuses them back together while leaving genuine grain
 * boundaries (a real brightness step) intact. Validated against synthetic
 * grain images with internal slip-line texture before landing this.
 */
function watershedSegmentGrains(gray: Float32Array, w: number, h: number, minArea: number): Int32Array {
  const segGray = boxBlur(gray, w, h, 2);
  const segMag = sobelMagnitude(segGray, w, h);
  const seedThreshold = percentileValue(segMag, 18);
  const seedMask = new Uint8Array(w * h);
  for (let i = 0; i < seedMask.length; i++) if (segMag[i] <= seedThreshold) seedMask[i] = 1;
  let seeds = connectedComponentsMask(seedMask, w, h);
  if (seeds.count === 0) {
    // Degenerate (near-uniform) gradient: seed from the single lowest-gradient pixel.
    let minIdx = 0;
    for (let i = 1; i < segMag.length; i++) if (segMag[i] < segMag[minIdx]) minIdx = i;
    seeds.labels[minIdx] = 1;
    seeds = { labels: seeds.labels, count: 1 };
  }
  const grown = watershedGrow(segMag, w, h, seeds.labels);
  const means = meansByLabel(gray, grown, seeds.count);
  const merged = ragMergeByMean(grown, w, h, means, GRAIN_MERGE_THRESHOLD);
  return absorbSmallRegions(merged, w, h, minArea);
}

function percentileFromCdf(values: number[], weights: number[], q: number): number {
  if (values.length === 0) return 0;
  const idx = values.map((_, i) => i).sort((a, b) => values[a] - values[b]);
  const total = weights.reduce((s, x) => s + x, 0);
  if (total <= 0) return values[idx[idx.length - 1]];
  const target = (q / 100) * total;
  let acc = 0;
  for (const i of idx) {
    acc += weights[i];
    if (acc >= target) return values[i];
  }
  return values[idx[idx.length - 1]];
}

function median(values: Float32Array | number[]): number {
  const arr = Array.from(values).sort((a, b) => a - b);
  if (arr.length === 0) return 0;
  const mid = arr.length >> 1;
  return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
}

function astmG(meanEcdUm: number | null): number | null {
  if (meanEcdUm === null || meanEcdUm <= 0) return null;
  const dMm = meanEcdUm / 1000;
  return -3.2877 - 6.6439 * Math.log10(dMm);
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

function boundaryMask(labels: Int32Array, w: number, h: number): Uint8Array {
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      const l = labels[p];
      if ((x < w - 1 && labels[p + 1] !== l) || (y < h - 1 && labels[p + w] !== l)) {
        mask[p] = 1;
      }
    }
  }
  return mask;
}

type RegionStat = {
  label: number;
  area: number;
  sumX: number;
  sumY: number;
  touchesEdge: boolean;
};

function regionStats(labels: Int32Array, w: number, h: number, count: number): Map<number, RegionStat> {
  const stats = new Map<number, RegionStat>();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const l = labels[y * w + x];
      if (l <= 0) continue;
      let s = stats.get(l);
      if (!s) {
        s = { label: l, area: 0, sumX: 0, sumY: 0, touchesEdge: false };
        stats.set(l, s);
      }
      s.area += 1;
      s.sumX += x;
      s.sumY += y;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) s.touchesEdge = true;
    }
  }
  void count;
  return stats;
}

const CLIENT_NOTE = "브라우저에서 계산한 근사 결과입니다. 정밀 분석은 로컬 Python 백엔드를 사용하세요.";

export async function runIpf(
  file: File,
  opts: { umPerPixel: number | null; minGrainPx: number; excludeEdge: boolean },
): Promise<IpfResult> {
  const { data, w, h, ow, oh, scale } = await loadImageData(file);
  const { labels, count } = regionGrow(data, w, h, 46);
  const stats = regionStats(labels, w, h, count);
  const areaToOriginal = 1 / (scale * scale);
  const minAreaResized = Math.max(4, Math.round(opts.minGrainPx * scale * scale));
  const hasScale = opts.umPerPixel !== null;
  const um = opts.umPerPixel ?? 1;

  type G = { id: number; area_px: number; area: number; ecd: number; touches_edge: boolean; cx: number; cy: number };
  const grains: G[] = [];
  let edgeCount = 0;
  for (const s of stats.values()) {
    if (s.area < minAreaResized) continue;
    if (s.touchesEdge) edgeCount += 1;
    if (opts.excludeEdge && s.touchesEdge) continue;
    const areaPx = s.area * areaToOriginal;
    const areaPhys = hasScale ? areaPx * um * um : areaPx;
    const ecd = 2 * Math.sqrt(areaPhys / Math.PI);
    grains.push({
      id: s.label,
      area_px: areaPx,
      area: areaPhys,
      ecd,
      touches_edge: s.touchesEdge,
      cx: s.sumX / s.area / scale,
      cy: s.sumY / s.area / scale,
    });
  }
  if (grains.length === 0) throw new Error("검출된 Grain이 없습니다. 최소 면적을 낮춰 보세요.");

  grains.sort((a, b) => b.area - a.area);
  const areas = grains.map((g) => g.area);
  const ecds = grains.map((g) => g.ecd);
  const totalArea = areas.reduce((s, x) => s + x, 0);
  const meanEcd = ecds.reduce((s, x) => s + x, 0) / ecds.length;
  const unit: "µm" | "px" = hasScale ? "µm" : "px";

  // Histogram of ECD (area-fraction weighted).
  const lo = Math.min(...ecds);
  const hi = Math.max(...ecds);
  const bins = 12;
  const edges: number[] = [];
  const span = hi > lo ? hi - lo : 1;
  for (let i = 0; i <= bins; i++) edges.push(lo + (span * i) / bins);
  const histogram = [];
  for (let i = 0; i < bins; i++) {
    let areaSum = 0;
    let cnt = 0;
    for (let g = 0; g < ecds.length; g++) {
      const last = i === bins - 1;
      if (ecds[g] >= edges[i] && (last ? ecds[g] <= edges[i + 1] : ecds[g] < edges[i + 1])) {
        areaSum += areas[g];
        cnt += 1;
      }
    }
    histogram.push({ bin_start: edges[i], bin_end: edges[i + 1], count: cnt, area_fraction: areaSum / (totalArea || 1) });
  }

  // Size classes.
  const classEdges = hasScale ? [0, 5, 10, 20, 50, 100, Infinity] : [0, 20, 50, 100, 250, 500, Infinity];
  const classLabels = hasScale
    ? ["<5 µm", "5–10 µm", "10–20 µm", "20–50 µm", "50–100 µm", ">100 µm"]
    : ["<20 px", "20–50 px", "50–100 px", "100–250 px", "250–500 px", ">500 px"];
  const size_classes = classLabels.map((label, i) => {
    let areaSum = 0;
    let cnt = 0;
    for (let g = 0; g < ecds.length; g++) {
      if (ecds[g] >= classEdges[i] && ecds[g] < classEdges[i + 1]) {
        areaSum += areas[g];
        cnt += 1;
      }
    }
    return { label, count: cnt, area_fraction: areaSum / (totalArea || 1) };
  });

  // Orientation (cubic IPF-Z) color fractions + texture index from hue entropy.
  let red = 0;
  let green = 0;
  let blue = 0;
  let other = 0;
  const hueHist = new Array(18).fill(0);
  const npx = w * h;
  for (let p = 0, i = 0; i < npx; i++, p += 4) {
    const r = data[p];
    const g = data[p + 1];
    const b = data[p + 2];
    const tot = r + g + b + 1e-6;
    const rn = r / tot;
    const gn = g / tot;
    const bn = b / tot;
    if (rn >= gn && rn >= bn && rn > 0.42) red += 1;
    else if (gn >= rn && gn >= bn && gn > 0.42) green += 1;
    else if (bn >= rn && bn >= gn && bn > 0.42) blue += 1;
    else other += 1;
    const { h: hue } = rgbToHsv(r, g, b);
    const hb = Math.min(17, Math.floor((hue / 360) * 18));
    hueHist[hb] += 1;
  }
  const hueTotal = hueHist.reduce((s, x) => s + x, 0) || 1;
  let entropy = 0;
  for (const c of hueHist) {
    const pr = c / hueTotal + 1e-12;
    entropy += -pr * Math.log(pr);
  }
  const textureIndex = 1 - entropy / Math.log(18);
  const texture = [
    { label: "<001> (적)", area_fraction: red / npx },
    { label: "<101> (녹)", area_fraction: green / npx },
    { label: "<111> (청)", area_fraction: blue / npx },
    { label: "기타", area_fraction: other / npx },
  ];

  // Overlay: dim original + gold boundaries.
  const mask = boundaryMask(labels, w, h);
  const px = new Uint8ClampedArray(data.length);
  for (let i = 0, p = 0; i < npx; i++, p += 4) {
    if (mask[i]) {
      px[p] = 255;
      px[p + 1] = 208;
      px[p + 2] = 64;
      px[p + 3] = 255;
    } else {
      px[p] = data[p] * 0.85;
      px[p + 1] = data[p + 1] * 0.85;
      px[p + 2] = data[p + 2] * 0.85;
      px[p + 3] = 255;
    }
  }
  const overlay = overlayToBase64(w, h, px);

  const analyzedPixels = grains.reduce((s, g) => s + g.area_px, 0);
  const notes = [
    CLIENT_NOTE,
    "같은 색이어도 공간적으로 떨어지면 서로 다른 Grain으로 집계합니다.",
    "방위 분율은 표준 cubic IPF-Z 색(적<001>, 녹<101>, 청<111>)에 대한 근사입니다.",
  ];
  if (!hasScale) notes.push("스케일이 없어 길이/면적은 pixel 단위이며 ASTM G는 계산하지 않습니다.");

  return {
    kind: "ipf",
    summary: {
      grain_count: grains.length,
      edge_grain_count: edgeCount,
      mean_ecd: meanEcd,
      median_ecd: median(ecds),
      d10: percentileFromCdf(ecds, areas, 10),
      d50: percentileFromCdf(ecds, areas, 50),
      d90: percentileFromCdf(ecds, areas, 90),
      astm_g: astmG(hasScale ? meanEcd : null),
      unit,
      image_width: ow,
      image_height: oh,
      scale_um_per_px: opts.umPerPixel,
      analyzed_area_fraction: analyzedPixels / (ow * oh),
      method: "client_region_grow",
      min_grain_px: opts.minGrainPx,
      exclude_edge: opts.excludeEdge,
      texture_index: textureIndex,
    },
    histogram,
    size_classes,
    texture,
    grains: grains.map((g) => ({
      id: g.id,
      area_px: g.area_px,
      area: g.area,
      ecd: g.ecd,
      area_fraction: g.area / (totalArea || 1),
      touches_edge: g.touches_edge,
      centroid_x: g.cx,
      centroid_y: g.cy,
    })),
    overlay_png_base64: overlay,
    notes,
  };
}

export async function runSem(
  file: File,
  opts: { umPerPixel: number | null; minFeaturePx: number },
): Promise<SemResult> {
  const { data, w, h, ow, oh, scale } = await loadImageData(file);
  const gray = toGray(data, w, h);
  const npx = w * h;
  const minArea = Math.max(8, Math.round(opts.minFeaturePx * scale * scale));

  // Sobel gradients.
  const mag = new Float32Array(npx);
  const ang = new Float32Array(npx);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx =
        -gray[i - w - 1] - 2 * gray[i - 1] - gray[i + w - 1] + gray[i - w + 1] + 2 * gray[i + 1] + gray[i + w + 1];
      const gy =
        -gray[i - w - 1] - 2 * gray[i - w] - gray[i - w + 1] + gray[i + w - 1] + 2 * gray[i + w] + gray[i + w + 1];
      mag[i] = Math.sqrt(gx * gx + gy * gy);
      let a = (Math.atan2(gy, gx) * 180) / Math.PI;
      a = ((a % 180) + 180) % 180;
      ang[i] = a;
    }
  }

  // Orientation texture histogram (8 bins) weighted by strong gradients.
  const sortedMag = Float32Array.from(mag).sort();
  const p70 = sortedMag[Math.floor(sortedMag.length * 0.7)] || 0;
  const p85 = sortedMag[Math.floor(sortedMag.length * 0.85)] || 0;
  const texBins = new Array(8).fill(0);
  for (let i = 0; i < npx; i++) {
    if (mag[i] > p70) {
      const b = Math.min(7, Math.floor((ang[i] / 180) * 8));
      texBins[b] += mag[i];
    }
  }
  const texTotal = texBins.reduce((s, x) => s + x, 0) || 1;
  const texFrac = texBins.map((x) => x / texTotal);
  const meanFrac = texFrac.reduce((s, x) => s + x, 0) / texFrac.length || 1e-9;
  const anisotropy = Math.max(...texFrac) / meanFrac;
  const texture = texFrac.map((fraction, i) => ({ label: `${i * 22.5}–${(i + 1) * 22.5}°`, fraction }));

  // Traces = strong edge pixels; count connected edge components >= min length.
  const edge = new Uint8Array(npx);
  let edgePx = 0;
  for (let i = 0; i < npx; i++) {
    if (mag[i] >= p85) {
      edge[i] = 1;
      edgePx += 1;
    }
  }
  // connected components of edge mask
  const edgeLabels = new Int32Array(npx).fill(0);
  const stack = new Int32Array(npx);
  let comp = 0;
  let traceCount = 0;
  for (let start = 0; start < npx; start++) {
    if (edge[start] === 0 || edgeLabels[start] !== 0) continue;
    comp += 1;
    let top = 0;
    let size = 0;
    edgeLabels[start] = comp;
    stack[top++] = start;
    while (top > 0) {
      const p = stack[--top];
      size += 1;
      const px = p % w;
      const py = (p / w) | 0;
      const nb = [
        px > 0 ? p - 1 : -1,
        px < w - 1 ? p + 1 : -1,
        py > 0 ? p - w : -1,
        py < h - 1 ? p + w : -1,
      ];
      for (let k = 0; k < 4; k++) {
        const q = nb[k];
        if (q < 0 || edge[q] === 0 || edgeLabels[q] !== 0) continue;
        edgeLabels[q] = comp;
        stack[top++] = q;
      }
    }
    if (size >= Math.max(12, opts.minFeaturePx)) traceCount += 1;
  }

  // Grain areas via marker-controlled watershed (see watershedSegmentGrains) —
  // independent of the trace/dislocation edge mask above.
  const grainLabels = watershedSegmentGrains(gray, w, h, minArea);
  const gstats = regionStats(grainLabels, w, h, 0);
  const areaToOriginal = 1 / (scale * scale);
  const hasScale = opts.umPerPixel !== null;
  const um = opts.umPerPixel ?? 1;
  const grainsRaw: { id: number; area_px: number; area: number; ecd: number; touches_edge: boolean; cx: number; cy: number }[] = [];
  for (const s of gstats.values()) {
    if (s.area < minArea) continue;
    const areaPx = s.area * areaToOriginal;
    const areaPhys = hasScale ? areaPx * um * um : areaPx;
    grainsRaw.push({
      id: s.label,
      area_px: areaPx,
      area: areaPhys,
      ecd: 2 * Math.sqrt(areaPhys / Math.PI),
      touches_edge: s.touchesEdge,
      cx: s.sumX / s.area / scale,
      cy: s.sumY / s.area / scale,
    });
  }
  grainsRaw.sort((a, b) => b.area - a.area);
  const totalGrainArea = grainsRaw.reduce((s, g) => s + g.area, 0) || 1;
  const grains = grainsRaw.map((g) => ({
    id: g.id,
    area_px: g.area_px,
    area: g.area,
    ecd: g.ecd,
    area_fraction: g.area / totalGrainArea,
    touches_edge: g.touches_edge,
    centroid_x: g.cx,
    centroid_y: g.cy,
  }));
  const grainCount = grains.length;

  const lengthOrig = edgePx / Math.max(scale, 1e-9);
  const areaPx = ow * oh;
  let density: number;
  let densityUnit: string;
  if (opts.umPerPixel) {
    density = (lengthOrig * opts.umPerPixel) / Math.max(areaPx * opts.umPerPixel * opts.umPerPixel, 1e-9);
    densityUnit = "µm⁻¹";
  } else {
    density = lengthOrig / Math.max(areaPx, 1);
    densityUnit = "px⁻¹";
  }

  // Contrast and substructure.
  let mean = 0;
  for (let i = 0; i < npx; i++) mean += gray[i];
  mean /= npx;
  let variance = 0;
  for (let i = 0; i < npx; i++) variance += (gray[i] - mean) * (gray[i] - mean);
  const contrast = Math.sqrt(variance / npx) / 255;
  // local mean via simple box blur (radius 4)
  let substructure = 0;
  const r = 4;
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      let sum = 0;
      let cnt = 0;
      for (let dy = -r; dy <= r; dy += 2) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -r; dx <= r; dx += 2) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          sum += gray[yy * w + xx];
          cnt += 1;
        }
      }
      substructure += Math.abs(gray[y * w + x] - sum / cnt);
    }
  }
  substructure = substructure / ((Math.ceil(h / 2) * Math.ceil(w / 2)) || 1) / 255;

  // Overlay: gold = trace/dislocation edges, cyan = watershed grain boundaries.
  const grainBoundary = boundaryMask(grainLabels, w, h);
  const px = new Uint8ClampedArray(data.length);
  for (let i = 0, p = 0; i < npx; i++, p += 4) {
    if (edge[i]) {
      px[p] = 255;
      px[p + 1] = 208;
      px[p + 2] = 64;
      px[p + 3] = 255;
    } else if (grainBoundary[i]) {
      px[p] = 53;
      px[p + 1] = 208;
      px[p + 2] = 255;
      px[p + 3] = 255;
    } else {
      px[p] = data[p];
      px[p + 1] = data[p + 1];
      px[p + 2] = data[p + 2];
      px[p + 3] = 255;
    }
  }
  const overlay = overlayToBase64(w, h, px);

  const notes = [
    CLIENT_NOTE,
    "금색 선은 슬립 밴드·전위 콘트라스트 등 강한 에지(선형 흔적 후보)입니다.",
    "하늘색 선은 watershed로 구한 Grain 경계 후보이며, 아래 목록에서 면적·ECD를 확인할 수 있습니다.",
    "텍스처는 결정방위가 아니라 표면 형상/콘트라스트의 방향 이방성입니다.",
  ];
  if (!opts.umPerPixel) notes.push("스케일이 없어 흔적 밀도와 Grain 면적은 pixel 단위입니다.");

  return {
    kind: "sem",
    summary: {
      grain_count: grainCount,
      trace_count: traceCount,
      trace_density: density,
      density_unit: densityUnit,
      contrast,
      substructure,
      anisotropy,
      unit: opts.umPerPixel ? "µm" : "px",
      image_width: ow,
      image_height: oh,
      scale_um_per_px: opts.umPerPixel,
      method: "client_watershed_grains",
    },
    texture,
    grains,
    overlay_png_base64: overlay,
    notes,
  };
}

function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  const rr = r / 255;
  const gg = g / 255;
  const bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rr) h = ((gg - bb) / d) % 6;
    else if (max === gg) h = (bb - rr) / d + 2;
    else h = (rr - gg) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  return { h, s, v: max };
}

export async function runKam(
  file: File,
  opts: { umPerPixel: number | null; maxKamDeg: number; recrystallizedCut: number; deformedCut: number },
): Promise<KamResult> {
  if (!(opts.recrystallizedCut > 0 && opts.recrystallizedCut < opts.deformedCut)) {
    throw new Error("재결정 임계값은 변형 임계값보다 작아야 합니다.");
  }
  const { data, w, h, ow, oh } = await loadImageData(file);
  const npx = w * h;
  const kam = new Float32Array(npx);

  // Estimate whether the map is colored (rainbow) or grayscale.
  let satSum = 0;
  for (let p = 0, i = 0; i < npx; i++, p += 4) {
    satSum += rgbToHsv(data[p], data[p + 1], data[p + 2]).s;
  }
  const grayish = satSum / npx < 0.18;

  for (let p = 0, i = 0; i < npx; i++, p += 4) {
    const { h: hue, v } = rgbToHsv(data[p], data[p + 1], data[p + 2]);
    let field: number;
    if (grayish) {
      field = v;
    } else {
      const hOpen = hue / 2; // match OpenCV 0..180 hue scale
      field = Math.min(1, Math.max(0, (120 - hOpen) / 120));
      if (hOpen > 145) field = 1;
    }
    kam[i] = field * opts.maxKamDeg;
  }

  let meanKam = 0;
  let rx = 0;
  let recovered = 0;
  let deformed = 0;
  for (let i = 0; i < npx; i++) {
    meanKam += kam[i];
    if (kam[i] < opts.recrystallizedCut) rx += 1;
    else if (kam[i] < opts.deformedCut) recovered += 1;
    else deformed += 1;
  }
  meanKam /= npx;

  const bins = 12;
  const histogram = [];
  const step = opts.maxKamDeg / bins;
  const counts = new Array(bins).fill(0);
  for (let i = 0; i < npx; i++) {
    let b = Math.floor(kam[i] / step);
    if (b >= bins) b = bins - 1;
    if (b < 0) b = 0;
    counts[b] += 1;
  }
  for (let i = 0; i < bins; i++) {
    histogram.push({
      bin_start: step * i,
      bin_end: step * (i + 1),
      count: counts[i],
      area_fraction: counts[i] / npx,
    });
  }

  let gnd: number | null = null;
  if (opts.umPerPixel !== null) {
    const theta = (meanKam * Math.PI) / 180;
    const stepM = opts.umPerPixel * 1e-6;
    const burgersM = 0.248 * 1e-9;
    gnd = theta / (burgersM * stepM);
  }

  // Overlay: heat blend + high-strain highlight.
  const px = new Uint8ClampedArray(data.length);
  for (let i = 0, p = 0; i < npx; i++, p += 4) {
    const heat = Math.min(255, (kam[i] / Math.max(opts.deformedCut, 1e-6)) * 255);
    let rr = data[p] * 0.55 + heat * 0.45;
    let gg = data[p + 1] * 0.55;
    let bb = data[p + 2] * 0.55 + 40 * 0.45;
    if (kam[i] >= opts.deformedCut) {
      rr = data[p] * 0.45 + 255 * 0.55;
      gg = data[p + 1] * 0.45 + 80 * 0.55;
      bb = data[p + 2] * 0.45 + 40 * 0.55;
    }
    px[p] = rr;
    px[p + 1] = gg;
    px[p + 2] = bb;
    px[p + 3] = 255;
  }
  const overlay = overlayToBase64(w, h, px);

  const notes = [
    CLIENT_NOTE,
    "컬러 KAM 맵의 색(파랑=낮음, 빨강=높음)을 각도로 환산합니다.",
    `색 스케일은 지정한 최댓값 ${opts.maxKamDeg}°에 선형 매핑됩니다.`,
    `재결정 분율은 KAM < ${opts.recrystallizedCut}°, 변형 분율은 KAM ≥ ${opts.deformedCut}°.`,
  ];
  if (gnd === null) notes.push("GND 밀도 근사는 스텝 크기(µm/pixel)가 필요합니다.");
  else notes.push("GND 밀도는 ρ ≈ θ / (b · λ) 근사입니다 (b=0.248 nm, bcc Fe).");

  return {
    kind: "kam",
    summary: {
      mean_kam_deg: meanKam,
      median_kam_deg: median(kam),
      recrystallized_fraction: rx / npx,
      recovered_fraction: recovered / npx,
      deformed_fraction: deformed / npx,
      gnd_density: gnd,
      gnd_unit: "m⁻²",
      max_kam_deg: opts.maxKamDeg,
      image_width: ow,
      image_height: oh,
      scale_um_per_px: opts.umPerPixel,
      method: "client_colormap_kam",
    },
    histogram,
    classes: [
      { label: `재결정 <${opts.recrystallizedCut}°`, area_fraction: rx / npx },
      { label: `회복 ${opts.recrystallizedCut}–${opts.deformedCut}°`, area_fraction: recovered / npx },
      { label: `변형 ≥${opts.deformedCut}°`, area_fraction: deformed / npx },
    ],
    overlay_png_base64: overlay,
    notes,
  };
}
