import type { Metadata, Viewport } from "next";
import "@/styles/parkdodo-ui.css";
import "./app.css";

export const metadata: Metadata = {
  title: { default: "ParkDodo 停車營運中心", template: "%s｜ParkDodo" },
  description: "ParkDodo 停車場營運後台",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#17232B" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;700&family=Noto+Serif+TC:wght@500;700&family=JetBrains+Mono:wght@400;600&display=swap" />
      </head>
      <body>{children}</body>
    </html>
  );
}
