import Link from "next/link";
import { SiteHeader } from "./components/ui";

const MAPS = [
  {
    href: "/sem",
    code: "SEM",
    title: "주사전자현미경",
    body: "SEM 이미지에서 Grain 콘트라스트, 슬립 밴드·전위 흔적, 표면 텍스처 이방성을 분석합니다.",
    items: ["전위/슬립 흔적", "채널링 콘트라스트", "형태 텍스처"],
  },
  {
    href: "/ipf",
    code: "IPF",
    title: "Inverse Pole Figure",
    body: "IPF 맵에서 Grain 크기·분율과 cubic 방위 텍스처(<001>/<101>/<111>)를 분석합니다.",
    items: ["Grain 크기", "면적분율", "방위 텍스처"],
  },
  {
    href: "/kam",
    code: "KAM",
    title: "Kernel Average Misorientation",
    body: "KAM 맵에서 국소 변형, 재결정/변형 분율, GND 밀도 근사를 분석합니다.",
    items: ["평균 KAM", "재결정 분율", "GND 근사"],
  },
];

export default function HomePage() {
  return (
    <main className="mx-auto min-h-screen max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <SiteHeader current="home" />
      <section className="mb-10 max-w-3xl">
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">금속 미세조직 분석</h1>
        <p className="mt-4 text-base leading-7 text-metal-muted">
          분석할 맵 종류를 선택하세요. SEM, IPF, KAM 페이지가 분리되어 있으며, 각 페이지에서 해당 이미지에 맞는 정량 지표를 계산합니다.
        </p>
      </section>
      <section className="grid gap-5 md:grid-cols-3">
        {MAPS.map((map) => (
          <Link
            key={map.href}
            href={map.href}
            className="group flex flex-col rounded-2xl border border-metal-line bg-metal-panel p-6 transition hover:border-metal-gold/70"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-metal-gold">{map.code}</p>
            <h2 className="mt-3 text-2xl font-semibold">{map.title}</h2>
            <p className="mt-3 flex-1 text-sm leading-6 text-metal-muted">{map.body}</p>
            <ul className="mt-4 space-y-1 text-xs text-metal-muted">
              {map.items.map((item) => (
                <li key={item}>· {item}</li>
              ))}
            </ul>
            <span className="mt-6 inline-flex w-full items-center justify-center rounded-xl bg-metal-gold px-4 py-3 text-sm font-semibold text-metal-bg group-hover:brightness-110">
              {map.code} 분석으로 이동
            </span>
          </Link>
        ))}
      </section>
    </main>
  );
}
