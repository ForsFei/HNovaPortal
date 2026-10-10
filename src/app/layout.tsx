import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "HNova Portal — 个人网站与服务入口",
  description: "集中管理网站、加密书签和本地服务的个人门户。"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
