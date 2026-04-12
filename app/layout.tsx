import type { Metadata } from "next";
import { Gowun_Batang, Inter, Playfair_Display } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
});

const playfairDisplay = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-playfair",
  display: "swap",
});

const gowunBatang = Gowun_Batang({
  weight: ["400", "700"],
  subsets: ["latin"],
  variable: "--font-gowun",
  display: "swap",
});

export const metadata: Metadata = {
  title: "ViewPoint",
  description: "같은 주제, 다른 시선으로 책을 큐레이션합니다.",
  icons: {
    icon: [
      { url: "/favicon.png" },
      { url: "/favicon.png", sizes: "32x32", type: "image/png" },
    ],
    shortcut: "/favicon.png",
    apple: [
      { url: "/favicon.png", sizes: "180x180", type: "image/png" },
    ],
  },
  // 모바일 사파리 미리보기를 위해 아래 속성도 추가하면 좋습니다.
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "ViewPoint",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className="h-full">
      <body
        className={`${inter.className} ${playfairDisplay.variable} ${gowunBatang.variable} flex min-h-screen flex-col antialiased`}
      >
        <main className="flex min-h-0 flex-1 flex-col">{children}</main>
      </body>
    </html>
  );
}
