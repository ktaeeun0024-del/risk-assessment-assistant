import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "반장노트",
  description: "작업 내용을 말로 설명하면 위험성평가표 초안을 만들고, 코드가 다시 검사합니다. 소규모 공장을 위한 위험성평가 도우미.",
};

export const viewport: Viewport = {
  themeColor: "#1f1c1a",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <head>
        {/* Pretendard (가변 굵기, 화면에 쓰인 글자만 나눠 받는 dynamic subset 판) */}
        <link rel="preconnect" href="https://cdn.jsdelivr.net" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          crossOrigin="anonymous"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        />
        {/* 외국인 근로자용 요약의 크메르·미얀마·네팔어 글자 (그 글자를 쓸 때만 받는다) */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Noto+Sans+Devanagari:wght@400;700&family=Noto+Sans+Khmer:wght@400;700&family=Noto+Sans+Myanmar:wght@400;700&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
