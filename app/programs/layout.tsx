import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "수업 프로그램 및 결제 안내 | 옥진수학",
  description: "옥진수학 맞춤형 온라인 수학 코칭 수업 프로그램, 수강료 및 결제/환불 안내",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export default function ProgramsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="programs-container w-full">{children}</div>;
}
