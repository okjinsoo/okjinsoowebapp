import type { ReactNode } from "react";

/** 화면 머리: 왼쪽 제목, 오른쪽 버튼(대표 버튼 1개 + 더보기) */
export default function PageHeader({ title, actions }: { title: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-header">
      <h1 className="page-title">{title}</h1>
      {actions ? <div className="page-header-actions">{actions}</div> : null}
    </header>
  );
}

/** 자주 안 쓰는 버튼을 접어 두는 '더보기' 메뉴 (기존 .more-menu 모양 재사용) */
export function MoreMenu({ children }: { children: ReactNode }) {
  return (
    <details className="more-menu">
      <summary className="btn btn-white" aria-label="더보기">더보기</summary>
      <div className="more-menu-panel">{children}</div>
    </details>
  );
}
