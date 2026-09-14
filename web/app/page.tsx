"use client";

import { useMemo, useRef, useState } from "react";
import type { AnalysisResult } from "./lib/types";

const ACCEPT = "image/png,image/jpeg,image/tiff,image/webp,.png,.jpg,.jpeg,.tif,.tiff,.webp";

function formatNum(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return value.toLocaleString("ko-KR", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

function formatPct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function downloadCsv(result: AnalysisResult) {
  const unit = result.summary.unit;
  const header = ["id", `area_${unit === "µm" ? "um2" : "px"}`, `ecd_${unit}`, "area_fraction", "touches_edge", "centroid_x", "centroid_y"];
  const rows = result.grains.map((g) =>
    [g.id, g.area, g.ecd, g.area_fraction, g.touches_edge, g.centroid_x, g.centroid_y].join(","),
  );
  const blob = new Blob([[header.join(","), ...rows].join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "ebsd-grain-analysis.csv";
  a.click();
  URL.revokeObjectURL(url);
}

export default function HomePage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [umPerPixel, setUmPerPixel] = useState("");
  const [minGrainPx, setMinGrainPx] = useState(30);
  const [excludeEdge, setExcludeEdge] = useState(false);
  const [showOverlay, setShowOverlay] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);

  const overlayUrl = useMemo(() => {
    if (!result) return null;
    return `data:image/png;base64,${result.overlay_png_base64}`;
  }, [result]);

  function onPick(next: File | null) {
    setResult(null);
    setError(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(next);
    setPreviewUrl(next ? URL.createObjectURL(next) : null);
  }

  async function onAnalyze() {
    if (!file) {
      setError("분석할 이미지를 먼저 업로드하세요.");
      return;
    }
    setLoading(true);
    setError(null);
    const form = new FormData();
    form.append("file", file);
    form.append("min_grain_px", String(minGrainPx));
    form.append("exclude_edge", String(excludeEdge));
    if (umPerPixel.trim()) form.append("um_per_pixel", umPerPixel.trim());

    try {
      const res = await fetch("/api/analyze", { method: "POST", body: form });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.detail || "분석에 실패했습니다.");
      }
      setResult(body as AnalysisResult);
      setShowOverlay(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "분석에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }

  const unit = result?.summary.unit ?? "px";
  const displayImage = showOverlay && overlayUrl ? overlayUrl : previewUrl;
  const tableRows = result?.grains.slice(0, 50) ?? [];
  const maxHist = Math.max(0.0001, ...(result?.histogram.map((b) => b.area_fraction) ?? [0]));

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-8 flex flex-col gap-3 border-b border-metal-line pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.22em] text-metal-gold">Metal Analysis AI</p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">EBSD Grain 분석</h1>
          <p className="mt-2 max-w-2xl text-sm text-metal-muted">
            EBSD 맵 이미지를 올리면 Grain 크기, 면적분율, D10/D50/D90을 자동으로 계산합니다.
          </p>
        </div>
        <span className="rounded-full border border-metal-line px-3 py-1 text-xs text-metal-muted">v0.1 · 이미지 분할</span>
      </header>

      <section className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
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
            <img src={previewUrl} alt="업로드 미리보기" className="max-h-72 w-full rounded-lg object-contain" />
          ) : (
            <>
              <p className="text-lg font-medium">EBSD 맵 이미지를 드래그하거나 클릭하여 업로드</p>
              <p className="mt-2 text-sm text-metal-muted">PNG, JPEG, TIFF · IPF map / grain map</p>
            </>
          )}
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => onPick(e.target.files?.[0] ?? null)}
          />
          {file && <p className="mt-3 text-xs text-metal-muted">{file.name}</p>}
        </div>

        <div className="space-y-4 rounded-2xl border border-metal-line bg-metal-panel p-5">
          <label className="block text-sm">
            <span className="mb-1 block text-metal-muted">스케일 µm/pixel (선택)</span>
            <input
              type="number"
              min="0"
              step="0.001"
              placeholder="예: 0.25"
              value={umPerPixel}
              onChange={(e) => setUmPerPixel(e.target.value)}
              className="w-full rounded-lg border border-metal-line bg-metal-bg px-3 py-2 outline-none focus:border-metal-gold"
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-metal-muted">최소 Grain 면적: {minGrainPx} px</span>
            <input
              type="range"
              min={8}
              max={400}
              value={minGrainPx}
              onChange={(e) => setMinGrainPx(Number(e.target.value))}
              className="w-full"
            />
          </label>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={excludeEdge}
              onChange={(e) => setExcludeEdge(e.target.checked)}
              className="h-4 w-4"
            />
            가장자리 Grain 제외
          </label>

          <button
            type="button"
            onClick={onAnalyze}
            disabled={loading || !file}
            className="w-full rounded-xl bg-metal-gold px-4 py-3 text-sm font-semibold text-metal-bg transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "분석 중…" : "Grain 분석 실행"}
          </button>

          {error && <p className="text-sm text-red-400">{error}</p>}
          <p className="text-xs leading-5 text-metal-muted">
            1차는 이미지 분할(ASTM E1382류)입니다. `.ctf` / `.ang` 방위 데이터 기반 ASTM E2627 분석은 다음 단계입니다.
          </p>
        </div>
      </section>

      {result && (
        <section className="mt-10 space-y-6">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi label="Grain 수" value={formatNum(result.summary.grain_count, 0)} hint={`가장자리 ${result.summary.edge_grain_count}개`} />
            <Kpi label={`평균 ECD (${unit})`} value={formatNum(result.summary.mean_ecd)} hint={`중앙값 ${formatNum(result.summary.median_ecd)}`} />
            <Kpi label={`D50 (${unit})`} value={formatNum(result.summary.d50)} hint={`D10 ${formatNum(result.summary.d10)} · D90 ${formatNum(result.summary.d90)}`} />
            <Kpi
              label="ASTM G (근사)"
              value={result.summary.astm_g === null ? "스케일 필요" : formatNum(result.summary.astm_g)}
              hint={`${result.summary.image_width}×${result.summary.image_height} px`}
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-2xl border border-metal-line bg-metal-panel p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold">분할 오버레이</h2>
                <button
                  type="button"
                  onClick={() => setShowOverlay((v) => !v)}
                  className="rounded-full border border-metal-line px-3 py-1 text-xs text-metal-muted hover:text-metal-text"
                >
                  {showOverlay ? "원본 보기" : "오버레이 보기"}
                </button>
              </div>
              {displayImage && (
                <img src={displayImage} alt="분석 결과" className="max-h-[420px] w-full rounded-lg object-contain" />
              )}
            </div>

            <div className="rounded-2xl border border-metal-line bg-metal-panel p-4">
              <h2 className="mb-4 text-sm font-semibold">ECD 분포 (면적분율)</h2>
              <div className="flex h-56 items-end gap-1">
                {result.histogram.map((bin) => (
                  <div key={`${bin.bin_start}-${bin.bin_end}`} className="flex flex-1 flex-col items-center gap-1">
                    <div
                      className="w-full rounded-t bg-metal-gold/80"
                      style={{ height: `${Math.max(4, (bin.area_fraction / maxHist) * 100)}%` }}
                      title={`${formatNum(bin.bin_start)}–${formatNum(bin.bin_end)} ${unit} · ${formatPct(bin.area_fraction)}`}
                    />
                    <span className="w-full truncate text-center text-[10px] text-metal-muted">{formatNum(bin.bin_start, 1)}</span>
                  </div>
                ))}
              </div>
              <ul className="mt-4 space-y-1 text-xs text-metal-muted">
                {result.size_classes.map((cls) => (
                  <li key={cls.label} className="flex justify-between">
                    <span>{cls.label}</span>
                    <span>
                      {cls.count}개 · {formatPct(cls.area_fraction)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="rounded-2xl border border-metal-line bg-metal-panel p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Grain 목록 (면적 상위 {tableRows.length})</h2>
              <button
                type="button"
                onClick={() => downloadCsv(result)}
                className="rounded-full border border-metal-line px-3 py-1 text-xs text-metal-muted hover:text-metal-text"
              >
                CSV 다운로드
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="text-xs uppercase text-metal-muted">
                  <tr>
                    <th className="py-2">ID</th>
                    <th>면적 ({unit === "µm" ? "µm²" : "px"})</th>
                    <th>ECD ({unit})</th>
                    <th>면적분율</th>
                    <th>가장자리</th>
                  </tr>
                </thead>
                <tbody>
                  {tableRows.map((g) => (
                    <tr key={g.id} className="border-t border-metal-line/70">
                      <td className="py-2">{g.id}</td>
                      <td>{formatNum(g.area)}</td>
                      <td>{formatNum(g.ecd)}</td>
                      <td>{formatPct(g.area_fraction)}</td>
                      <td>{g.touches_edge ? "예" : "아니오"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
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

function Kpi({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <article className="rounded-2xl border border-metal-line bg-metal-panel px-4 py-4">
      <p className="text-xs text-metal-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p>
      <p className="mt-1 text-xs text-metal-muted">{hint}</p>
    </article>
  );
}
