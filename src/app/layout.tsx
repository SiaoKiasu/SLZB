import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "SLZB · 账户观察室",
  description: "现货账户的资产、盈亏与交易，一目了然。",
  robots: { index: false, follow: false },
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
