/**
 * fracto_core.js — 파면(fractography) SEM 이미지 정량분석 핵심 알고리즘
 * 외부 라이브러리 의존성 없음 (OpenCV.js 불필요) — 브라우저(<script>)와 Node.js 양쪽에서 동작(UMD)
 *
 * 사용 순서 (예시):
 *   const smoothed = FractoCore.boxBlur(grayArray, w, h, radius, passes);
 *   const { markers, count } = FractoCore.findSeeds(smoothed, w, h, minDist);
 *   const { gx, gy, mag } = FractoCore.sobel(smoothed, w, h);
 *   const labels = FractoCore.watershed(mag, markers, w, h);
 *   const areas  = FractoCore.regionAreas(labels, count);       // px^2 단위
 *   const bmask  = FractoCore.boundaryMask(labels, w, h);       // 경계선 오버레이용
 *   const oriBins = FractoCore.orientationHistogram(gx, gy, mag, 18, 0.85); // 능선 방향 분포
 *
 * 주의(연구자용 설계 원칙 — README.md 참고):
 * - watershed는 "밝기 = 지형"이라는 근사이며, findSeeds의 minDist 파라미터에 결과가 민감합니다.
 *   -> 절대적인 결정립 크기 측정이 아니라 같은 파라미터로 여러 시편/영역을 상대비교하는 용도로 쓰세요.
 * - 여기서 나오는 facet 크기는 실제 결정립 크기와 별도로(EBSD 등) 검증이 필요합니다.
 */
// ---- 핵심 알고리즘 (순수 JS, 외부 라이브러리 없음) ----

function boxBlur(src, w, h, radius, passes) {
  let a = Float32Array.from(src);
  let b = new Float32Array(w * h);
  for (let p = 0; p < passes; p++) {
    // horizontal
    for (let y = 0; y < h; y++) {
      let rowOff = y * w;
      let acc = 0, count = 0;
      for (let x = -radius; x <= radius; x++) {
        let xi = Math.min(w - 1, Math.max(0, x));
        acc += a[rowOff + xi]; count++;
      }
      b[rowOff] = acc / count;
      for (let x = 1; x < w; x++) {
        let xOut = x - radius - 1, xIn = x + radius;
        xOut = Math.min(w - 1, Math.max(0, xOut));
        xIn = Math.min(w - 1, Math.max(0, xIn));
        acc += a[rowOff + xIn] - a[rowOff + xOut];
        b[rowOff + x] = acc / count;
      }
    }
    // vertical
    let c = new Float32Array(w * h);
    for (let x = 0; x < w; x++) {
      let acc = 0, count = 0;
      for (let y = -radius; y <= radius; y++) {
        let yi = Math.min(h - 1, Math.max(0, y));
        acc += b[yi * w + x]; count++;
      }
      c[x] = acc / count;
      for (let y = 1; y < h; y++) {
        let yOut = y - radius - 1, yIn = y + radius;
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

function sobel(src, w, h) {
  const gx = new Float32Array(w * h);
  const gy = new Float32Array(w * h);
  const mag = new Float32Array(w * h);
  const at = (x, y) => src[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const gxv = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1)) -
                  (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
      const gyv = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1)) -
                  (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
      const idx = y * w + x;
      gx[idx] = gxv; gy[idx] = gyv;
      mag[idx] = Math.hypot(gxv, gyv);
    }
  }
  return { gx, gy, mag };
}

// 국소 최소값(어두운 골짜기 후보) 찾기 -> 최소 간격(minDist)으로 솎아내기
function findSeeds(smoothed, w, h, minDist) {
  const candidates = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const v = smoothed[y * w + x];
      let isMin = true;
      for (let dy = -1; dy <= 1 && isMin; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          if (smoothed[(y + dy) * w + (x + dx)] < v) { isMin = false; break; }
        }
      }
      if (isMin) candidates.push({ x, y, v });
    }
  }
  candidates.sort((a, b) => a.v - b.v); // 어두운 순으로
  const accepted = [];
  const minDist2 = minDist * minDist;
  for (const c of candidates) {
    let ok = true;
    for (const s of accepted) {
      const dx = c.x - s.x, dy = c.y - s.y;
      if (dx * dx + dy * dy < minDist2) { ok = false; break; }
    }
    if (ok) accepted.push(c);
  }
  const markers = new Int32Array(w * h).fill(-1);
  accepted.forEach((s, i) => { markers[s.y * w + s.x] = i; });
  return { markers, count: accepted.length, seeds: accepted };
}

// 최소-힙(우선순위 큐): elevation이 낮은 픽셀부터 정확히 꺼내기 위해 사용
// (버킷을 앞에서부터 한 번만 훑으면, 나중에 발견된 낮은 표고 픽셀을 놓치는 버그가 생기므로 힙을 씀)
class MinHeap {
  constructor() { this.arr = []; }
  get size() { return this.arr.length; }
  push(item) {
    const a = this.arr; a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]]; i = p;
    }
  }
  pop() {
    const a = this.arr; const top = a[0]; const last = a.pop();
    if (a.length) {
      a[0] = last; let i = 0;
      while (true) {
        let l = 2 * i + 1, r = 2 * i + 2, smallest = i;
        if (l < a.length && a[l][0] < a[smallest][0]) smallest = l;
        if (r < a.length && a[r][0] < a[smallest][0]) smallest = r;
        if (smallest === i) break;
        [a[i], a[smallest]] = [a[smallest], a[i]]; i = smallest;
      }
    }
    return top;
  }
}

// marker-controlled watershed (elevation 낮은 픽셀부터 정확히 전파 - 최소힙 사용)
function watershed(elevation, markers, w, h) {
  const labels = Int32Array.from(markers);
  const inQueue = new Uint8Array(w * h);
  const heap = new MinHeap();

  const pushNeighbors = (x, y) => {
    const nb = [[1,0],[-1,0],[0,1],[0,-1]];
    for (const [dx, dy] of nb) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const nidx = ny * w + nx;
      if (labels[nidx] === -1 && !inQueue[nidx]) {
        inQueue[nidx] = 1;
        heap.push([elevation[nidx], nidx]);
      }
    }
  };

  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (labels[y * w + x] !== -1) pushNeighbors(x, y);
  }

  while (heap.size) {
    const [, idx] = heap.pop();
    inQueue[idx] = 0;
    if (labels[idx] !== -1) continue; // 이미 다른 경로로 라벨됨
    const x = idx % w, y = (idx / w) | 0;
    const nb = [[1,0],[-1,0],[0,1],[0,-1]];
    let assigned = -1;
    for (const [dx, dy] of nb) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const l = labels[ny * w + nx];
      if (l >= 0) { assigned = l; break; } // 먼저 닿은 라벨 배정 (경계는 boundaryMask로 별도 검출)
    }
    if (assigned !== -1) {
      labels[idx] = assigned;
      pushNeighbors(x, y);
    }
  }
  return labels;
}

function regionAreas(labels, count) {
  const areas = new Array(count).fill(0);
  for (let i = 0; i < labels.length; i++) if (labels[i] >= 0) areas[labels[i]]++;
  return areas;
}

function boundaryMask(labels, w, h) {
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const idx = y * w + x, l = labels[idx];
    if (l < 0) continue;
    if ((x + 1 < w && labels[idx + 1] !== l) || (y + 1 < h && labels[idx + w] !== l)) mask[idx] = 1;
  }
  return mask;
}

// 강한 능선(ridge)의 방향 분포 (0~180도, 세기로 가중)
function orientationHistogram(gx, gy, mag, nbins, percentileThresh) {
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


// 크기 리스트(예: facet 등가지름, 결정립 크기)를 큰->작은 순 정렬해
// 상위 N개 + 평균/중앙값을 엑셀 붙여넣기(TSV)와 CSV로 바로 뽑아주는 유틸
// values 단위는 호출하는 쪽에서 맞춰서 넣으면 됩니다(예: um).
function sizeReport(values, topN, unitLabel) {
  topN = topN || 20;
  unitLabel = unitLabel || 'um';
  const arr = Array.from(values).filter(v => Number.isFinite(v));
  const desc = [...arr].sort((a, b) => b - a);
  const top = desc.slice(0, Math.min(topN, desc.length));
  const n = arr.length;
  const mean = n ? arr.reduce((a, b) => a + b, 0) / n : NaN;
  const sortedAsc = [...arr].sort((a, b) => a - b);
  const median = n ? (n % 2 ? sortedAsc[(n - 1) / 2] : (sortedAsc[n / 2 - 1] + sortedAsc[n / 2]) / 2) : NaN;

  const header = ['순위', `크기(${unitLabel})`];
  const rows = top.map((v, i) => [String(i + 1), v.toFixed(2)]);
  const summaryRows = [
    ['', ''],
    ['평균 (n=' + n + ')', mean.toFixed(2)],
    ['중앙값', median.toFixed(2)],
  ];
  const allRows = [header, ...rows, ...summaryRows];
  const csv = allRows.map(r => r.join(',')).join('\n');
  const tsv = allRows.map(r => r.join('\t')).join('\n'); // 엑셀에 그대로 붙여넣기용

  return { all: arr, sortedDesc: desc, top, n, mean, median, csv, tsv };
}

const FractoCore = { boxBlur, sobel, findSeeds, watershed, regionAreas, boundaryMask, orientationHistogram, sizeReport };
if (typeof module !== 'undefined' && module.exports) {
  module.exports = FractoCore;
} else if (typeof window !== 'undefined') {
  window.FractoCore = FractoCore;
}
