import type { Metadata } from "next";
import { Noto_Sans_KR } from "next/font/google";
import "./globals.css";

const sans = Noto_Sans_KR({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Metal Analysis AI",
  description: "SEM, IPF, KAM 맵에서 금속 미세조직을 분석합니다.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className={`${sans.variable} font-sans text-metal-text antialiased`}>{children}</body>
    </html>
  );
}
