import type { NextConfig } from "next";

const isPages = process.env.GITHUB_PAGES === "true";
const repo = "EBSD_analysis_ai";

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  ...(isPages ? { basePath: `/${repo}`, assetPrefix: `/${repo}/` } : {}),
};

export default nextConfig;
