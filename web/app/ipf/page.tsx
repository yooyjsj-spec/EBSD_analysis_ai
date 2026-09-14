"use client";

import { useMemo, useRef, useState } from "react";
import { Histogram, KpiCard, SiteHeader, formatNum, formatPct } from "../components/ui";
import { runIpf } from "../lib/clientAnalysis";
import type { IpfResult } from "../lib/types";

const ACCEPT = "image/png,image/jpeg,image/tiff,image/webp,.png,.jpg,.jpeg,.tif,.tiff,.webp";

function downloadCsv(result: IpfResult) {
  const unit = result.summary.unit;
  const header = ["id", `area_${unit === "µm" ? "um2" : "px"}`, `ecd_${unit}`, "area_fraction", "touches_edge"];
  const rows = result.grains.map((g) => [g.id, g.area, g.ecd, g.area_fraction, g.touches_edge].join(","));
  const blob = new Blob([[header.join(","), ...rows].join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "ipf-grain-analysis.csv";
  a.click();
  URL.revokeObjectURL(url);
}

export default function IpfPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [umPerPixel, setUmPerPixel] = useState("");
  const [minGrainPx, setMinGrainPx] = useState(30);
  const [excludeEdge, setExcludeEdge] = useState(false);
  const [showOverlay, setShowOverlay] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<IpfResult | null>(null);

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
      setError("분석할 IPF 맵을 먼저 업로드하세요.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const body = await runIpf(file, {
        umPerPixel: umPerPixel.trim() ? Number(umPerPixel.trim()) : null,
        minGrainPx,
        excludeEdge,
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
  const tableRows = result?.grains.slice(0, 50) ?? [];

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <SiteHeader current="ipf" />
      <h1 className="text-3xl font-semibold tracking-tight">IPF 맵 분석</h1>
      <p className="mt-2 max-w-2xl text-sm text-metal-muted">
        Inverse Pole Figure 맵에서 Grain 크기, 면적분율, cubic 방위 텍스처를 계산합니다.
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
            <img src={previewUrl} alt="IPF 미리보기" className="max-h-72 w-full rounded-lg object-contain" />
          ) : (
            <>
              <p className="text-lg font-medium">IPF 맵을 드래그하거나 클릭하여 업로드</p>
              <p className="mt-2 text-sm text-metal-muted">PNG, JPEG, TIFF · IPF-X/Y/Z</p>
            </>
          )}
          <input ref={inputRef} type="file" accept={ACCEPT} className="hidden" onChange={(e) => onPick(e.target.files?.[0] ?? null)} />
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
            <input type="range" min={8} max={400} value={minGrainPx} onChange={(e) => setMinGrainPx(Number(e.target.value))} className="w-full" />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={excludeEdge} onChange={(e) => setExcludeEdge(e.target.checked)} className="h-4 w-4" />
            가장자리 Grain 제외
          </label>
          <button
            type="button"
            onClick={onAnalyze}
            disabled={loading || !file}
            className="w-full rounded-xl bg-metal-gold px-4 py-3 text-sm font-semibold text-metal-bg transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "분석 중…" : "IPF 분석 실행"}
          </button>
          {error && <p className="text-sm text-red-400">{error}</p>}
        </div>
      </section>

      {result && (
        <section className="mt-10 space-y-6">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard label="Grain 수" value={formatNum(result.summary.grain_count, 0)} hint={`가장자리 ${result.summary.edge_grain_count}개`} />
            <KpiCard label={`평균 ECD (${unit})`} value={formatNum(result.summary.mean_ecd)} hint={`D50 ${formatNum(result.summary.d50)}`} />
            <KpiCard label="ASTM G (근사)" value={result.summary.astm_g === null ? "스케일 필요" : formatNum(result.summary.astm_g)} />
            <KpiCard label="텍스처 지수" value={formatNum(result.summary.texture_index)} hint="1에 가까울수록 집합조직이 강함" />
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-2xl border border-metal-line bg-metal-panel p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold">분할 오버레이</h2>
                <button type="button" onClick={() => setShowOverlay((v) => !v)} className="rounded-full border border-metal-line px-3 py-1 text-xs text-metal-muted">
                  {showOverlay ? "원본 보기" : "오버레이 보기"}
                </button>
              </div>
              {displayImage && <img src={displayImage} alt="IPF 결과" className="mx-auto max-h-[480px] w-full rounded-lg bg-black/30 object-contain" />}
            </div>
            <div className="rounded-2xl border border-metal-line bg-metal-panel p-4">
              <h2 className="mb-4 text-sm font-semibold">ECD 분포 / 방위 분율</h2>
              <Histogram bins={result.histogram} unit={unit} />
              <ul className="mt-4 space-y-1 text-xs text-metal-muted">
                {(result.texture ?? []).map((cls) => (
                  <li key={cls.label} className="flex justify-between">
                    <span>{cls.label}</span>
                    <span>{formatPct(cls.area_fraction)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="rounded-2xl border border-metal-line bg-metal-panel p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Grain 목록 (상위 {tableRows.length})</h2>
              <button type="button" onClick={() => downloadCsv(result)} className="rounded-full border border-metal-line px-3 py-1 text-xs text-metal-muted">
                CSV 다운로드
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="text-xs uppercase text-metal-muted">
                  <tr>
                    <th className="py-2">ID</th>
                    <th>면적</th>
                    <th>ECD</th>
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
