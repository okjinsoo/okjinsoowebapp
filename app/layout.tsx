import type { Metadata } from "next";
import BrandHomeButton from "@/lib/ui/common/BrandHomeButton";
import SharedSnapshotAgent from "@/lib/ui/common/SharedSnapshotAgent";
import "./globals.css";

export const metadata: Metadata = {
  title: "옥진수학",
  description: "옥진수학 수업/학생 관리 웹앱",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <SharedSnapshotAgent />
        <div style={{ height: 56 }} />
        <div
          style={{
            position: "fixed",
            top: 8,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 50,
          }}
        >
          <BrandHomeButton />
        </div>
        <div
          style={{
            maxWidth: 980,
            width: "100%",
            margin: "0 auto",
            padding: "0 16px 24px",
          }}
        >
          {children}
        </div>
      </body>
    </html>
  );
}
