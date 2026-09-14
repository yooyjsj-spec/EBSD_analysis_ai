// Synthetic-image checks for the scale-bar locator.
// Run: node scripts/test-scale-bar.mjs

import { execSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const out = mkdtempSync(join(tmpdir(), "scalebar-"));
execSync(
  `npx tsc app/lib/scaleBar.ts --outDir ${out} --module esnext --target es2020 --lib es2020,dom --skipLibCheck`,
  { stdio: "inherit" },
);
const { locateScaleBar } = await import(join(out, "scaleBar.js"));

function makeImage({
  w = 1024,
  h = 768,
  bannerTop = 700,
  bannerValue = 0,
  barValue = 255,
  barX0 = 660,
  barLen = 280,
  barY = 730,
  barThick = 3,
  tickCount = 11,
  tickHeight = 9,
}) {
  const data = new Uint8ClampedArray(w * h * 4);
  const put = (x, y, v) => {
    const p = (y * w + x) * 4;
    data[p] = data[p + 1] = data[p + 2] = v;
    data[p + 3] = 255;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Micrograph area: mid-gray texture that must not be mistaken for a bar.
      const v = y < bannerTop ? 90 + ((x * 7 + y * 13) % 70) : bannerValue;
      put(x, y, v);
    }
  }
  for (let t = 0; t < barThick; t++)
    for (let x = barX0; x < barX0 + barLen; x++) put(x, barY + t, barValue);
  if (tickCount > 1) {
    const step = (barLen - 1) / (tickCount - 1);
    for (let i = 0; i < tickCount; i++) {
      const x = Math.round(barX0 + i * step);
      for (let y = barY - tickHeight; y < barY; y++) put(x, y, barValue);
    }
  }
  return { data, w, h };
}

let failures = 0;
function check(name, condition, detail) {
  if (condition) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("bright bar with 11 ticks / 10 divisions");
{
  const { data, w, h } = makeImage({});
  const found = locateScaleBar(data, w, h);
  check("bar located", !!found);
  if (found) {
    const span = found.ticks[found.ticks.length - 1] - found.ticks[0];
    check("polarity bright", found.polarity === "bright", found.polarity);
    check("length ~280", Math.abs(found.bar.length - 280) <= 2, String(found.bar.length));
    check("11 ticks", found.ticks.length === 11, String(found.ticks.length));
    check("span ~279", Math.abs(span - 279) <= 3, String(span));
  }
}

console.log("dark bar on a white banner");
{
  const { data, w, h } = makeImage({ bannerValue: 245, barValue: 10 });
  const found = locateScaleBar(data, w, h);
  check("bar located", !!found);
  if (found) {
    check("polarity dark", found.polarity === "dark", found.polarity);
    check("length ~280", Math.abs(found.bar.length - 280) <= 2, String(found.bar.length));
    check("11 ticks", found.ticks.length === 11, String(found.ticks.length));
  }
}

console.log("plain bar with no ticks");
{
  const { data, w, h } = makeImage({ tickCount: 0 });
  const found = locateScaleBar(data, w, h);
  check("bar located", !!found);
  if (found) {
    check("length ~280", Math.abs(found.bar.length - 280) <= 2, String(found.bar.length));
    check("no ticks usable", found.ticks.length < 3, String(found.ticks.length));
  }
}

console.log("bar drawn over the image instead of a banner");
{
  const { data, w, h } = makeImage({ bannerTop: 10000, barY: 700 });
  const found = locateScaleBar(data, w, h);
  check("bar located", !!found);
  if (found) check("length ~280", Math.abs(found.bar.length - 280) <= 2, String(found.bar.length));
}

console.log("small 6-division bar at bottom right");
{
  const { data, w, h } = makeImage({ barX0: 820, barLen: 150, tickCount: 7 });
  const found = locateScaleBar(data, w, h);
  check("bar located", !!found);
  if (found) check("7 ticks", found.ticks.length === 7, String(found.ticks.length));
}

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
