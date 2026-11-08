import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TG Grab · Telegram 媒体下载器",
  description:
    "粘贴 Telegram 链接，自动识别视频、图片、文件与相册，显示分辨率与大小，直接下载原始文件。支持私有频道（账号需已加入）。",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#05080d",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
