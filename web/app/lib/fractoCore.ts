// Marker-controlled watershed for SEM fractography.
// Port of fractography/fracto_core.js so the Next.js app can import it.

export function boxBlur(src: Float32Array, w: number, h: number, radius: number, passes: number): Float32Array {
  let a = Float32Array.from(src);
  for (let p = 0; p < passes; p++) {
    const b = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      const rowOff = y * w;
      let acc = 0;
      let count = 0;
      for (let x = -radius; x <= radius; x++) {
        const xi = Math.min(w - 1, Math.max(0, x));
        acc += a[rowOff + xi];
        count += 1;
      }
      b[rowOff] = acc / count;
      for (let x = 1; x < w; x++) {
        let xOut = x - radius - 1;
        let xIn = x + radius;
        xOut = Math.min(w - 1, Math.max(0, xOut));
        xIn = Math.min(w - 1, Math.max(0, xIn));
        acc += a[rowOff + xIn] - a[rowOff + xOut];
        b[rowOff + x] = acc / count;
      }
    }
    const c = new Float32Array(w * h);
    for (let x = 0; x < w; x++) {
      let acc = 0;
      let count = 0;
      for (let y = -radius; y <= radius; y++) {
        const yi = Math.min(h - 1, Math.max(0, y));
        acc += b[yi * w + x];
        count += 1;
      }
      c[x] = acc / count;
      for (let y = 1; y < h; y++) {
        let yOut = y - radius - 1;
        let yIn = y + radius;
        yOut = Math.min(h - 1, Math.max(0, yOut));
        yIn = Math.min(h - 1, Math.max(0, yIn));
        acc += b[yIn * w + x] - b[yOut * w + x];
        c[y * w + x] = acc / count;
      }
    }
    a = c;
  }
  return a;
}

export function sobel(src: Float32Array, w: number, h: number): {
  gx: Float32Array;
  gy: Float32Array;
  mag: Float32Array;
} {
  const gx = new Float32Array(w * h);
  const gy = new Float32Array(w * h);
  const mag = new Float32Array(w * h);
  const at = (x: number, y: number) =>
    src[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const gxv =
        at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
      const gyv =
        at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
      const idx = y * w + x;
      gx[idx] = gxv;
      gy[idx] = gyv;
      mag[idx] = Math.hypot(gxv, gyv);
    }
  }
  return { gx, gy, mag };
}

export type Seed = { x: number; y: number; v: number };

export function findSeeds(
  smoothed: Float32Array,
  w: number,
  h: number,
  minDist: number,
): { markers: Int32Array; count: number; seeds: Seed[] } {
  const candidates: Seed[] = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const v = smoothed[y * w + x];
      let isMin = true;
      for (let dy = -1; dy <= 1 && isMin; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          if (smoothed[(y + dy) * w + (x + dx)] < v) {
            isMin = false;
            break;
          }
        }
      }
      if (isMin) candidates.push({ x, y, v });
    }
  }
  candidates.sort((a, b) => a.v - b.v);
  const accepted: Seed[] = [];
  const minDist2 = minDist * minDist;
  for (const c of candidates) {
    let ok = true;
    for (const s of accepted) {
      const dx = c.x - s.x;
      const dy = c.y - s.y;
      if (dx * dx + dy * dy < minDist2) {
        ok = false;
        break;
      }
    }
    if (ok) accepted.push(c);
  }
  const markers = new Int32Array(w * h).fill(-1);
  accepted.forEach((s, i) => {
    markers[s.y * w + s.x] = i;
  });
  return { markers, count: accepted.length, seeds: accepted };
}

class MinHeap {
  arr: [number, number][] = [];
  get size() {
    return this.arr.length;
  }
  push(item: [number, number]) {
    const a = this.arr;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): [number, number] {
    const a = this.arr;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      while (true) {
        const l = 2 * i + 1;
        const r = 2 * i + 2;
        let smallest = i;
        if (l < a.length && a[l][0] < a[smallest][0]) smallest = l;
        if (r < a.length && a[r][0] < a[smallest][0]) smallest = r;
        if (smallest === i) break;
        [a[i], a[smallest]] = [a[smallest], a[i]];
        i = smallest;
      }
    }
    return top;
  }
}

export function watershed(elevation: Float32Array, markers: Int32Array, w: number, h: number): Int32Array {
  const labels = Int32Array.from(markers);
  const inQueue = new Uint8Array(w * h);
  const heap = new MinHeap();
  const nb = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const;

  const pushNeighbors = (x: number, y: number) => {
    for (const [dx, dy] of nb) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const nidx = ny * w + nx;
      if (labels[nidx] === -1 && !inQueue[nidx]) {
        inQueue[nidx] = 1;
        heap.push([elevation[nidx], nidx]);
      }
    }
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (labels[y * w + x] !== -1) pushNeighbors(x, y);
    }
  }

  while (heap.size) {
    const [, idx] = heap.pop();
    inQueue[idx] = 0;
    if (labels[idx] !== -1) continue;
    const x = idx % w;
    const y = (idx / w) | 0;
    let assigned = -1;
    for (const [dx, dy] of nb) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const l = labels[ny * w + nx];
      if (l >= 0) {
        assigned = l;
        break;
      }
    }
    if (assigned !== -1) {
      labels[idx] = assigned;
      pushNeighbors(x, y);
    }
  }
  return labels;
}

export function regionAreas(labels: Int32Array, count: number): number[] {
  const areas = new Array(count).fill(0);
  for (let i = 0; i < labels.length; i++) if (labels[i] >= 0) areas[labels[i]] += 1;
  return areas;
}

export function boundaryMask(labels: Int32Array, w: number, h: number): Uint8Array {
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      const l = labels[idx];
      if (l < 0) continue;
      if ((x + 1 < w && labels[idx + 1] !== l) || (y + 1 < h && labels[idx + w] !== l)) mask[idx] = 1;
    }
  }
  return mask;
}

export function orientationHistogram(
  gx: Float32Array,
  gy: Float32Array,
  mag: Float32Array,
  nbins: number,
  percentileThresh: number,
): Float32Array {
  const sorted = Float32Array.from(mag).sort();
  const thrIdx = Math.floor(sorted.length * percentileThresh);
  const thr = sorted[thrIdx];
  const bins = new Float32Array(nbins);
  const binWidth = 180 / nbins;
  for (let i = 0; i < mag.length; i++) {
    if (mag[i] < thr) continue;
    let angDeg = (Math.atan2(gy[i], gx[i]) + Math.PI / 2) * (180 / Math.PI);
    angDeg = ((angDeg % 180) + 180) % 180;
    const b = Math.min(nbins - 1, Math.floor(angDeg / binWidth));
    bins[b] += mag[i];
  }
  return bins;
}

export function sizeReport(values: number[], topN = 20, unitLabel = "um") {
  const arr = Array.from(values).filter((v) => Number.isFinite(v));
  const desc = [...arr].sort((a, b) => b - a);
  const top = desc.slice(0, Math.min(topN, desc.length));
  const n = arr.length;
  const mean = n ? arr.reduce((a, b) => a + b, 0) / n : NaN;
  const sortedAsc = [...arr].sort((a, b) => a - b);
  const median = n ? (n % 2 ? sortedAsc[(n - 1) / 2] : (sortedAsc[n / 2 - 1] + sortedAsc[n / 2]) / 2) : NaN;
  const header = ["순위", `크기(${unitLabel})`];
  const rows = top.map((v, i) => [String(i + 1), v.toFixed(2)]);
  const summaryRows = [
    ["", ""],
    [`평균 (n=${n})`, mean.toFixed(2)],
    ["중앙값", median.toFixed(2)],
  ];
  const allRows = [header, ...rows, ...summaryRows];
  return {
    all: arr,
    sortedDesc: desc,
    top,
    n,
    mean,
    median,
    csv: allRows.map((r) => r.join(",")).join("\n"),
    tsv: allRows.map((r) => r.join("\t")).join("\n"),
  };
}
