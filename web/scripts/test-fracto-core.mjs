// Synthetic checks for the fractography core.
// Run: node scripts/test-fracto-core.mjs

import { execSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const out = mkdtempSync(join(tmpdir(), "fracto-"));
execSync(
  `npx tsc app/lib/fractoCore.ts --outDir ${out} --module esnext --target es2020 --lib es2020,dom --skipLibCheck`,
  { stdio: "inherit" },
);
const core = await import(join(out, "fractoCore.js"));

let failures = 0;
function check(name, condition, detail) {
  if (condition) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("sizeReport sorts largest first");
{
  const report = core.sizeReport([3, 10, 7, 1], 2, "µm");
  check("n=4", report.n === 4);
  check("top two", report.top[0] === 10 && report.top[1] === 7, String(report.top));
  check("mean 5.25", Math.abs(report.mean - 5.25) < 1e-9, String(report.mean));
  check("median 5", report.median === 5, String(report.median));
  check("csv has header", report.csv.startsWith("순위,크기(µm)"));
}

console.log("watershed splits two dark basins");
{
  const w = 40;
  const h = 20;
  const mag = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // High ridge at x=20, low basins on either side.
      mag[y * w + x] = 20 - Math.abs(x - 19.5);
    }
  }
  const markers = new Int32Array(w * h).fill(-1);
  markers[10 * w + 5] = 0;
  markers[10 * w + 34] = 1;
  const labels = core.watershed(mag, markers, w, h);
  const areas = core.regionAreas(labels, 2);
  check("both labels used", areas[0] > 100 && areas[1] > 100, String(areas));
  check("left pixel is 0", labels[10 * w + 2] === 0, String(labels[10 * w + 2]));
  check("right pixel is 1", labels[10 * w + 37] === 1, String(labels[10 * w + 37]));
  const mask = core.boundaryMask(labels, w, h);
  let boundary = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) boundary += 1;
  check("boundary exists", boundary > 10, String(boundary));
}

console.log("orientationHistogram prefers a horizontal ridge");
{
  const w = 32;
  const h = 32;
  const gx = new Float32Array(w * h);
  const gy = new Float32Array(w * h);
  const mag = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      gx[i] = 0;
      gy[i] = 8;
      mag[i] = 8;
    }
  }
  const bins = core.orientationHistogram(gx, gy, mag, 18, 0.5);
  let maxI = 0;
  for (let i = 1; i < bins.length; i++) if (bins[i] > bins[maxI]) maxI = i;
  check("dominant bin near 0° (horizontal ridge)", maxI === 0 || maxI === 17, String(maxI));
}

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
