"use client";

import { useMemo, useRef, useState } from "react";
import { Histogram, KpiCard, SiteHeader, formatNum, formatPct, formatSci } from "../components/ui";
import type { KamResult } from "../lib/types";

const ACCEPT = "image/png,image/jpeg,image/tiff,image/webp,.png,.jpg,.jpeg,.tif,.tiff,.webp";

export default function KamPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [umPerPixel, setUmPerPixel] = useState("");
  const [maxKam, setMaxKam] = useState("5");
  const [rxCut, setRxCut] = useState("1");
  const [defCut, setDefCut] = useState("2.5");
  const [showOverlay, setShowOverlay] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<KamResult | null>(null);

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
      setError("분석할 KAM 맵을 먼저 업로드하세요.");
      return;
    }
    setLoading(true);
    setError(null);
    const form = new FormData();
    form.append("file", file);
    form.append("max_kam_deg", maxKam);
    form.append("recrystallized_cut", rxCut);
    form.append("deformed_cut", defCut);
    if (umPerPixel.trim()) form.append("um_per_pixel", umPerPixel.trim());
    try {
      const res = await fetch("/api/analyze/kam", { method: "POST", body: form });
      const body = await res.json();
      if (!res.ok) throw new Error(body.detail || "분석에 실패했습니다.");
      setResult(body as KamResult);
      setShowOverlay(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "분석에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }

  const displayImage = showOverlay && overlayUrl ? overlayUrl : previewUrl;

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <SiteHeader current="kam" />
      <h1 className="text-3xl font-semibold tracking-tight">KAM 맵 분석</h1>
      <p className="mt-2 max-w-2xl text-sm text-metal-muted">
        Kernel Average Misorientation 맵에서 국소 변형, 재결정/변형 분율, GND 밀도 근사를 계산합니다.
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
            <img src={previewUrl} alt="KAM 미리보기" className="max-h-72 w-full rounded-lg object-contain" />
          ) : (
            <>
              <p className="text-lg font-medium">KAM 맵을 드래그하거나 클릭하여 업로드</p>
              <p className="mt-2 text-sm text-metal-muted">파랑=저변형, 빨강=고변형 컬러맵 · PNG, JPEG, TIFF</p>
            </>
          )}
          <input ref={inputRef} type="file" accept={ACCEPT} className="hidden" onChange={(e) => onPick(e.target.files?.[0] ?? null)} />
          {file && <p className="mt-3 text-xs text-metal-muted">{file.name}</p>}
        </div>
        <div className="space-y-4 rounded-2xl border border-metal-line bg-metal-panel p-5">
          <label className="block text-sm">
            <span className="mb-1 block text-metal-muted">스케일 µm/pixel (GND용, 선택)</span>
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
            <span className="mb-1 block text-metal-muted">컬러바 최댓값 (°)</span>
            <input
              type="number"
              min="0.1"
              step="0.1"
              value={maxKam}
              onChange={(e) => setMaxKam(e.target.value)}
              className="w-full rounded-lg border border-metal-line bg-metal-bg px-3 py-2 outline-none focus:border-metal-gold"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="mb-1 block text-metal-muted">재결정 임계 (°)</span>
              <input
                type="number"
                min="0"
                step="0.1"
                value={rxCut}
                onChange={(e) => setRxCut(e.target.value)}
                className="w-full rounded-lg border border-metal-line bg-metal-bg px-3 py-2 outline-none focus:border-metal-gold"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-metal-muted">변형 임계 (°)</span>
              <input
                type="number"
                min="0"
                step="0.1"
                value={defCut}
                onChange={(e) => setDefCut(e.target.value)}
                className="w-full rounded-lg border border-metal-line bg-metal-bg px-3 py-2 outline-none focus:border-metal-gold"
              />
            </label>
          </div>
          <button
            type="button"
            onClick={onAnalyze}
            disabled={loading || !file}
            className="w-full rounded-xl bg-metal-gold px-4 py-3 text-sm font-semibold text-metal-bg transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "분석 중…" : "KAM 분석 실행"}
          </button>
          {error && <p className="text-sm text-red-400">{error}</p>}
        </div>
      </section>

      {result && (
        <section className="mt-10 space-y-6">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard label="평균 KAM" value={`${formatNum(result.summary.mean_kam_deg)}°`} hint={`중앙값 ${formatNum(result.summary.median_kam_deg)}°`} />
            <KpiCard label="재결정 분율" value={formatPct(result.summary.recrystallized_fraction)} />
            <KpiCard label="변형 분율" value={formatPct(result.summary.deformed_fraction)} hint={`회복 ${formatPct(result.summary.recovered_fraction)}`} />
            <KpiCard label="GND 밀도" value={formatSci(result.summary.gnd_density)} hint={result.summary.gnd_density ? result.summary.gnd_unit : "스케일 필요"} />
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-2xl border border-metal-line bg-metal-panel p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold">변형 오버레이</h2>
                <button type="button" onClick={() => setShowOverlay((v) => !v)} className="rounded-full border border-metal-line px-3 py-1 text-xs text-metal-muted">
                  {showOverlay ? "원본 보기" : "오버레이 보기"}
                </button>
              </div>
              {displayImage && <img src={displayImage} alt="KAM 결과" className="mx-auto max-h-[480px] w-full rounded-lg bg-black/30 object-contain" />}
            </div>
            <div className="rounded-2xl border border-metal-line bg-metal-panel p-4">
              <h2 className="mb-4 text-sm font-semibold">KAM 분포 (°)</h2>
              <Histogram bins={result.histogram} unit="°" />
              <ul className="mt-4 space-y-1 text-xs text-metal-muted">
                {result.classes.map((cls) => (
                  <li key={cls.label} className="flex justify-between">
                    <span>{cls.label}</span>
                    <span>{formatPct(cls.area_fraction)}</span>
                  </li>
                ))}
              </ul>
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
