import Link from "next/link";

export default function AppFooter() {
  return (
    <footer className="app-footer">
      <div className="app-footer-inner">
        <div className="app-footer-top">
          <div className="app-footer-brand">
            <span className="app-footer-logo">옥진수학</span>
            <span className="app-footer-tagline">1:1 맞춤형 온라인 수학 코칭</span>
          </div>
          <div className="app-footer-links">
            <Link href="/programs" className="app-footer-link font-semibold">
              수업 및 결제 안내
            </Link>
            <span className="app-footer-divider">|</span>
            <Link href="/policy" className="app-footer-link font-semibold">
              이용약관 및 개인정보처리방침
            </Link>
          </div>
        </div>

        <div className="app-footer-info">
          <div className="app-footer-info-row">
            <span><strong>상호명:</strong> 옥진수학</span>
            <span className="app-footer-divider">|</span>
            <span><strong>대표자명:</strong> 옥진수</span>
            <span className="app-footer-divider">|</span>
            <span><strong>사업자등록번호:</strong> 612-24-93399</span>
            <span className="app-footer-divider">|</span>
            <span><strong>통신판매업신고:</strong> 신고 준비중</span>
          </div>
          <div className="app-footer-info-row">
            <span><strong>사업장 주소:</strong> 서울특별시 마포구 백범로 205, 104-407</span>
          </div>
          <div className="app-footer-info-row">
            <span><strong>대표 전화번호:</strong> 010-8972-7209</span>
            <span className="app-footer-divider">|</span>
            <span><strong>대표 이메일:</strong> rapah0310@gmail.com</span>
          </div>
        </div>

        <div className="app-footer-bottom">
          <p className="app-footer-copy">
            © {new Date().getFullYear()} 옥진수학 (Okjin Math). All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
