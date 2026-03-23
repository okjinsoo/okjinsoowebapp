export default function StudentAreaLoading() {
  return (
    <main
      style={{
        minHeight: "calc(100vh - 56px)",
        display: "grid",
        placeItems: "center",
        padding: 16,
      }}
    >
      <section
        style={{
          width: "100%",
          maxWidth: 520,
          border: "1px solid var(--surface-border)",
          borderRadius: 12,
          padding: 16,
          background: "var(--surface-bg)",
        }}
      >
        <h1 style={{ fontSize: 24, fontWeight: 900 }}>학생 화면 준비 중...</h1>
        <p style={{ marginTop: 8, color: "var(--text-subtle)", lineHeight: 1.6 }}>
          버튼은 정상적으로 눌렸어요. 잠시만 기다려 주세요.
        </p>
      </section>
    </main>
  );
}
