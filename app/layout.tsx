import type { Metadata } from "next";
import BrandHomeButton from "@/lib/ui/common/BrandHomeButton";
import SharedSnapshotAgent from "@/lib/ui/common/SharedSnapshotAgent";
import PageTitleAgent from "@/lib/ui/common/PageTitleAgent";
import "./globals.css";

export const metadata: Metadata = {
  title: "옥진수학",
  description: "옥진수학 수업/학생 관리 웹앱",
  verification: {
    google: "Kr0SHMua76S5Ano47gd_jwZJwx2pBPlxMLSXgi0phvc",
  },
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
        <PageTitleAgent />
        <div className="app-topbar">
          <div className="app-topbar-inner">
            <BrandHomeButton />
          </div>
        </div>
        <div className="app-content">
          {children}
        </div>
      </body>
    </html>
  );
}
