import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "지식와 도전",
  description: "한국사·과학·지리·일반상식 4지선다 상식 퀴즈",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f7fb" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1117" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className="min-h-dvh antialiased">
        <header className="mx-auto flex w-full max-w-xl items-center px-4 pt-4">
          <Link href="/" className="text-sm font-bold tracking-tight text-indigo-600 dark:text-indigo-400">
            🧠 지식와 도전
          </Link>
        </header>
        <main className="mx-auto w-full max-w-xl px-4 pb-12 pt-4">{children}</main>
      </body>
    </html>
  );
}
