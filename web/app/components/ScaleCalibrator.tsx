"use client";

import { useEffect, useState } from "react";
import { detectScaleBar, type ScaleBarDetection } from "../lib/scaleBar";
import { formatNum } from "./ui";

type Props = {
  file: File | null;
  value: string;
  onChange: (next: string) => void;
};

export function ScaleCalibrator({ file, value, onChange }: Props) {
  const [detection, setDetection] = useState<ScaleBarDetection | null>(null);
  const [physical, setPhysical] = useState("10");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDetection(null);
    setError(null);
  }, [file]);

  const physicalUm = Number(physical);
  const umPerPixel =
    detection && Number.isFinite(physicalUm) && physicalUm > 0 && detection.spanPx > 0
      ? physicalUm / detection.spanPx
      : null;

  async function onDetect() {
    if (!file) {
      setError("이미지를 먼저 업로드하세요.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const found = await detectScaleBar(file);
      setDetection(found);
    } catch (err) {
      setDetection(null);
      setError(err instanceof Error ? err.message : "스케일바 인식에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  function onApply() {
    if (umPerPixel === null) return;
    onChange(String(Number(umPerPixel.toPrecision(6))));
  }

  const spanLabel =
    detection && detection.measuredFrom === "ticks"
      ? `눈금 ${detection.divisions}칸`
      : "스케일바 전체";

  return (
    <div className="space-y-3">
      <label className="block text-sm">
        <span className="mb-1 block text-metal-muted">스케일 µm/pixel (선택)</span>
        <input
          type="number"
          min="0"
          step="0.0001"
          placeholder="예: 0.05"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-lg border border-metal-line bg-metal-bg px-3 py-2 outline-none focus:border-metal-gold"
        />
      </label>

      <div className="rounded-xl border border-metal-line bg-metal-bg/60 p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-metal-muted">
            이미지 우하단 스케일바를 찾아 눈금 길이를 자동으로 잽니다.
          </p>
          <button
            type="button"
            onClick={onDetect}
            disabled={busy || !file}
            className="shrink-0 rounded-full border border-metal-gold px-3 py-1 text-xs font-semibold text-metal-gold transition hover:bg-metal-gold/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "인식 중…" : "스케일바 자동 인식"}
          </button>
        </div>

        {detection && (
          <div className="mt-3 space-y-3">
            <img
              src={`data:image/png;base64,${detection.previewPngBase64}`}
              alt="검출된 스케일바"
              className="w-full rounded-lg bg-black/40 object-contain"
            />
            <p className="text-xs text-metal-muted">
              눈금 {detection.tickCount}개 · {spanLabel} = {formatNum(detection.spanPx, 1)} px
              <span className="text-metal-muted/70">
                {" "}
                (이미지 폭 {detection.imageWidth}px의{" "}
                {formatNum((detection.spanPx / detection.imageWidth) * 100, 1)}%)
              </span>
            </p>
            <label className="block text-sm">
              <span className="mb-1 block text-metal-muted">{spanLabel}의 실제 길이 (µm)</span>
              <div className="flex gap-2">
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={physical}
                  onChange={(e) => setPhysical(e.target.value)}
                  className="w-full rounded-lg border border-metal-line bg-metal-bg px-3 py-2 outline-none focus:border-metal-gold"
                />
                <button
                  type="button"
                  onClick={onApply}
                  disabled={umPerPixel === null}
                  className="shrink-0 rounded-lg bg-metal-gold px-4 text-sm font-semibold text-metal-bg transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  적용
                </button>
              </div>
            </label>
            {umPerPixel !== null && (
              <p className="text-xs text-metal-gold">
                → {umPerPixel.toPrecision(4)} µm/pixel
                {detection.divisions > 0 && (
                  <span className="text-metal-muted">
                    {" "}
                    · 눈금 1칸 = {formatNum(physicalUm / detection.divisions, 3)} µm
                  </span>
                )}
              </p>
            )}
            {detection.measuredFrom === "bar" && (
              <p className="text-xs text-metal-muted">
                눈금을 구분하지 못해 스케일바 양 끝 길이를 사용했습니다.
              </p>
            )}
          </div>
        )}

        {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
      </div>
    </div>
  );
}
