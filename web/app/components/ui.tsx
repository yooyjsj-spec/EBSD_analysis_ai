import Link from "next/link";

const LINKS = [
  { href: "/sem", id: "sem", label: "SEM" },
  { href: "/ipf", id: "ipf", label: "IPF" },
  { href: "/kam", id: "kam", label: "KAM" },
] as const;

export function SiteHeader({ current }: { current?: "sem" | "ipf" | "kam" | "home" }) {
  return (
    <header className="mb-8 flex flex-col gap-4 border-b border-metal-line pb-6 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <Link href="/" className="mb-1 block text-xs font-semibold uppercase tracking-[0.22em] text-metal-gold">
          Metal Analysis AI
        </Link>
        <p className="text-sm text-metal-muted">SEM · IPF · KAM 맵 분석</p>
      </div>
      <nav className="flex flex-wrap gap-2">
        <Link
          href="/"
          className={`rounded-full border px-3 py-1 text-xs ${
            current === "home" || !current ? "border-metal-gold text-metal-gold" : "border-metal-line text-metal-muted hover:text-metal-text"
          }`}
        >
          홈
        </Link>
        {LINKS.map((link) => (
          <Link
            key={link.id}
            href={link.href}
            className={`rounded-full border px-3 py-1 text-xs ${
              current === link.id ? "border-metal-gold text-metal-gold" : "border-metal-line text-metal-muted hover:text-metal-text"
            }`}
          >
            {link.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}

export function KpiCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <article className="rounded-2xl border border-metal-line bg-metal-panel px-4 py-4">
      <p className="text-xs text-metal-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p>
      {hint ? <p className="mt-1 text-xs text-metal-muted">{hint}</p> : null}
    </article>
  );
}

export function formatNum(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return value.toLocaleString("ko-KR", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

export function formatPct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function formatSci(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return value.toExponential(2);
}

export function Histogram({
  bins,
  unit = "",
}: {
  bins: { bin_start: number; bin_end: number; area_fraction: number }[];
  unit?: string;
}) {
  const maxHist = Math.max(0.0001, ...bins.map((b) => b.area_fraction));
  return (
    <div className="flex h-56 items-end gap-1">
      {bins.map((bin) => (
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
  );
}
