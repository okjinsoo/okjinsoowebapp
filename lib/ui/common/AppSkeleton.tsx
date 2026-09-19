"use client";

import React from "react";

export function SkeletonBox({
  width = "100%",
  height = 20,
  borderRadius = 8,
  style,
  className = "",
}: {
  width?: string | number;
  height?: string | number;
  borderRadius?: string | number;
  style?: React.CSSProperties;
  className?: string;
}) {
  return (
    <div
      className={`skeleton-shimmer ${className}`}
      style={{
        width,
        height,
        borderRadius,
        ...style,
      }}
    />
  );
}

/**
 * 교사용 메인 페이지(/t/tmain, /a/tmain) 전용 고품질 스켈레톤 로딩 UI
 */
export function TeacherMainSkeleton() {
  return (
    <main className="p-6" style={{ maxWidth: 1200, margin: "0 auto" }}>
      {/* 상단 역할 / 제어 바 */}
      <div style={{ marginBottom: 16 }}>
        <div
          style={{
            background: "var(--surface-bg)",
            border: "1px solid var(--surface-border)",
            borderRadius: 12,
            padding: "12px 16px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <SkeletonBox width={120} height={32} borderRadius={8} />
            <SkeletonBox width={160} height={20} borderRadius={6} />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <SkeletonBox width={90} height={32} borderRadius={8} />
            <SkeletonBox width={130} height={32} borderRadius={8} />
          </div>
        </div>
      </div>

      {/* 헤더 타이틀 영역 */}
      <div style={{ textAlign: "center", margin: "20px 0 24px" }}>
        <SkeletonBox width={200} height={28} borderRadius={8} style={{ margin: "0 auto 8px" }} />
        <SkeletonBox width={140} height={16} borderRadius={6} style={{ margin: "0 auto" }} />
      </div>

      {/* 오늘 수업 섹션 뼈대 */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <SkeletonBox width={140} height={24} borderRadius={6} />
          <SkeletonBox width={80} height={18} borderRadius={6} />
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: 12,
          }}
        >
          {[1, 2].map((i) => (
            <div
              key={i}
              style={{
                background: "var(--surface-bg)",
                border: "1px solid var(--surface-border)",
                borderRadius: 14,
                padding: 16,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
                <SkeletonBox width={90} height={20} borderRadius={6} />
                <SkeletonBox width={60} height={20} borderRadius={12} />
              </div>
              <SkeletonBox width="70%" height={22} borderRadius={6} style={{ marginBottom: 8 }} />
              <SkeletonBox width="50%" height={16} borderRadius={6} style={{ marginBottom: 14 }} />
              <div style={{ display: "flex", gap: 8 }}>
                <SkeletonBox width="50%" height={34} borderRadius={8} />
                <SkeletonBox width="50%" height={34} borderRadius={8} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 배정 학생 명부 섹션 뼈대 */}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <SkeletonBox width={160} height={24} borderRadius={6} />
          <SkeletonBox width={100} height={32} borderRadius={8} />
        </div>
        <div
          style={{
            background: "var(--surface-bg)",
            border: "1px solid var(--surface-border)",
            borderRadius: 14,
            padding: 16,
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "10px 0",
                borderBottom: i < 4 ? "1px solid var(--surface-border)" : "none",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1 }}>
                <SkeletonBox width={40} height={40} borderRadius={20} />
                <div>
                  <SkeletonBox width={100} height={18} borderRadius={6} style={{ marginBottom: 6 }} />
                  <SkeletonBox width={140} height={14} borderRadius={4} />
                </div>
              </div>
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <SkeletonBox width={70} height={22} borderRadius={6} />
                <SkeletonBox width={80} height={32} borderRadius={8} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}

/**
 * 학생 상세/허브 페이지 전용 스켈레톤 UI
 */
export function StudentHubSkeleton() {
  return (
    <main className="p-6" style={{ maxWidth: 1200, margin: "0 auto" }}>
      {/* 상단 프로필 헤더 뼈대 */}
      <div
        style={{
          background: "var(--surface-bg)",
          border: "1px solid var(--surface-border)",
          borderRadius: 16,
          padding: 20,
          marginBottom: 24,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <SkeletonBox width={56} height={56} borderRadius={28} />
          <div>
            <SkeletonBox width={160} height={24} borderRadius={6} style={{ marginBottom: 8 }} />
            <SkeletonBox width={220} height={16} borderRadius={4} />
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <SkeletonBox width={100} height={36} borderRadius={8} />
          <SkeletonBox width={120} height={36} borderRadius={8} />
        </div>
      </div>

      {/* 회차 카드 그리드 뼈대 */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
          gap: 14,
        }}
      >
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div
            key={i}
            style={{
              background: "var(--surface-bg)",
              border: "1px solid var(--surface-border)",
              borderRadius: 14,
              padding: 16,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
              <SkeletonBox width={60} height={20} borderRadius={6} />
              <SkeletonBox width={50} height={20} borderRadius={10} />
            </div>
            <SkeletonBox width="80%" height={18} borderRadius={6} style={{ marginBottom: 8 }} />
            <SkeletonBox width="60%" height={14} borderRadius={4} style={{ marginBottom: 14 }} />
            <SkeletonBox width="100%" height={32} borderRadius={8} />
          </div>
        ))}
      </div>
    </main>
  );
}
