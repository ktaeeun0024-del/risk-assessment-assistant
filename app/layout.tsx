import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "위험성평가 도우미",
  description: "작업 내용을 말로 설명하면 위험성평가표 초안을 만들고, 코드가 다시 검사합니다.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
