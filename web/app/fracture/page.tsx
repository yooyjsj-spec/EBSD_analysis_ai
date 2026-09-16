"use client";

import { useMemo, useRef, useState } from "react";
import { ScaleCalibrator } from "../components/ScaleCalibrator";
import { Histogram, KpiCard, SiteHeader, formatNum, formatPct } from "../components/ui";
import { runFracture } from "../lib/fractureAnalysis";
import type { FractureResult } from "../lib/types";

const ACCEPT = "image/png,image/jpeg,image/tiff,image/webp,.png,.jpg,.jpeg,.tif,.tiff,.webp";

function downloadCsv(result: FractureResult) {
  const blob = new Blob([result.report_csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "fracture-facet-report.csv";
  a.click();
  URL.revokeObjectURL(url);
}

export default function FracturePage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [umPerPixel, setUmPerPixel] = useState("");
  const [blurRadius, setBlurRadius] = useState(3);
  const [minDist, setMinDist] = useState(10);
  const [showOverlay, setShowOverlay] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<FractureResult | null>(null);

  const overlayUrl = useMemo(
    () => (result ? `data:image/png;base64,${result.overlay_png_base64}` : null),
    [result],
  );

  function onPick(next: File | null) {
    setResult(null);
    setError(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(next);
    setPreviewUrl(next ? URL.createObjectURL(next) : null);
  }

  async function onAnalyze() {
    if (!file) {
      setError("분석할 파면 SEM 이미지를 먼저 업로드하세요.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const body = await runFracture(file, {
        umPerPixel: umPerPixel.trim() ? Number(umPerPixel.trim()) : null,
        blurRadius,
        minDist,
      });
      setResult(body);
      setShowOverlay(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "분석에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }

  const unit = result?.summary.unit ?? "px";
  const displayImage = showOverlay && overlayUrl ? overlayUrl : previewUrl;
  const maxTex = Math.max(0.0001, ...(result?.texture.map((t) => t.fraction) ?? [0]));

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <SiteHeader current="fracture" />
      <h1 className="text-3xl font-semibold tracking-tight">파면 균열 분석</h1>
      <p className="mt-2 max-w-2xl text-sm text-metal-muted">
        SEM 파면 이미지에서 facet/딤플을 분할하고 등가지름 분포와 능선 방향(이방성)을 계산합니다.
      </p>

      <section className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <div
          className="flex min-h-[280px] cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-metal-line bg-metal-panel/80 p-6 text-center transition hover:border-metal-gold/60"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            onPick(e.dataTransfer.files[0] ?? null);
          }}
        >
          {previewUrl ? (
            <img src={previewUrl} alt="파면 미리보기" className="max-h-72 w-full rounded-lg object-contain" />
          ) : (
            <>
              <p className="text-lg font-medium">파면 SEM 이미지를 드래그하거나 클릭하여 업로드</p>
              <p className="mt-2 text-sm text-metal-muted">Facet / 딤플 · PNG, JPEG, TIFF</p>
            </>
          )}
          <input ref={inputRef} type="file" accept={ACCEPT} className="hidden" onChange={(e) => onPick(e.target.files?.[0] ?? null)} />
          {file && <p className="mt-3 text-xs text-metal-muted">{file.name}</p>}
        </div>
        <div className="space-y-4 rounded-2xl border border-metal-line bg-metal-panel p-5">
          <ScaleCalibrator file={file} value={umPerPixel} onChange={setUmPerPixel} />
          <label className="block text-sm">
            <span className="mb-1 block text-metal-muted">블러 반경: {blurRadius} px</span>
            <input type="range" min={1} max={10} value={blurRadius} onChange={(e) => setBlurRadius(Number(e.target.value))} className="w-full" />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-metal-muted">최소 셀 간격: {minDist} px</span>
            <input type="range" min={3} max={60} value={minDist} onChange={(e) => setMinDist(Number(e.target.value))} className="w-full" />
          </label>
          <button
            type="button"
            onClick={onAnalyze}
            disabled={loading || !file}
            className="w-full rounded-xl bg-metal-gold px-4 py-3 text-sm font-semibold text-metal-bg transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "분석 중…" : "파면 분석 실행"}
          </button>
          {error && <p className="text-sm text-red-400">{error}</p>}
        </div>
      </section>

      {result && (
        <section className="mt-10 space-y-6">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard label="Facet 수" value={formatNum(result.summary.facet_count, 0)} />
            <KpiCard label={`중앙값 ECD (${unit})`} value={formatNum(result.summary.median_ecd)} hint={`평균 ${formatNum(result.summary.mean_ecd)}`} />
            <KpiCard label={`p10–p90 (${unit})`} value={`${formatNum(result.summary.p10)}–${formatNum(result.summary.p90)}`} />
            <KpiCard label="우세 능선 방향" value={result.summary.dominant_angle} />
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-2xl border border-metal-line bg-metal-panel p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold">경계선 오버레이</h2>
                <button type="button" onClick={() => setShowOverlay((v) => !v)} className="rounded-full border border-metal-line px-3 py-1 text-xs text-metal-muted">
                  {showOverlay ? "원본 보기" : "오버레이 보기"}
                </button>
              </div>
              {displayImage && <img src={displayImage} alt="파면 결과" className="mx-auto max-h-[480px] w-full rounded-lg bg-black/30 object-contain" />}
            </div>
            <div className="rounded-2xl border border-metal-line bg-metal-panel p-4">
              <h2 className="mb-4 text-sm font-semibold">등가지름 분포 ({unit})</h2>
              <Histogram bins={result.histogram} unit={unit} />
            </div>
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-2xl border border-metal-line bg-metal-panel p-4">
              <h2 className="mb-4 text-sm font-semibold">강한 능선 방향 (0–180°)</h2>
              <div className="flex h-56 items-end gap-1">
                {result.texture.map((bin) => (
                  <div key={bin.label} className="flex flex-1 flex-col items-center gap-1">
                    <div className="w-full rounded-t bg-metal-gold/80" style={{ height: `${Math.max(4, (bin.fraction / maxTex) * 100)}%` }} />
                    <span className="w-full truncate text-center text-[10px] text-metal-muted">{bin.label.split("–")[0]}</span>
                  </div>
                ))}
              </div>
              <ul className="mt-4 space-y-1 text-xs text-metal-muted">
                {result.texture
                  .slice()
                  .sort((a, b) => b.fraction - a.fraction)
                  .slice(0, 3)
                  .map((bin) => (
                    <li key={bin.label} className="flex justify-between">
                      <span>{bin.label}</span>
                      <span>{formatPct(bin.fraction)}</span>
                    </li>
                  ))}
              </ul>
            </div>
            <div className="rounded-2xl border border-metal-line bg-metal-panel p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold">상위 facet ({result.facets.length})</h2>
                <button type="button" onClick={() => downloadCsv(result)} className="rounded-full border border-metal-line px-3 py-1 text-xs text-metal-muted">
                  CSV 다운로드
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs uppercase text-metal-muted">
                    <tr>
                      <th className="py-2">순위</th>
                      <th>ECD ({unit})</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.facets.map((f) => (
                      <tr key={f.rank} className="border-t border-metal-line/70">
                        <td className="py-2">{f.rank}</td>
                        <td>{formatNum(f.ecd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          <ul className="space-y-1 text-xs text-metal-muted">
            {result.notes.map((note) => (
              <li key={note}>· {note}</li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
