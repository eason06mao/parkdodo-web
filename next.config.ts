import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone", // Cloud Run：只打包執行所需檔案
  poweredByHeader: false,
};

export default nextConfig;
