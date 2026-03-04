export function Logo() {
  return (
    <div style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", lineHeight: 1 }}>
      <div style={{ display: "flex", alignItems: "baseline", fontSize: 32, fontWeight: 900, fontFamily: "'Arial Black', Arial, sans-serif", letterSpacing: "-0.5px" }}>
        <span style={{ color: "#E8401C" }}>Føhns</span>
        <span style={{ color: "#1A2C4E" }}>Stiftstidende</span>
      </div>
      <div style={{ fontSize: 11, fontWeight: 600, color: "#1A2C4E", letterSpacing: "0.5px", marginTop: 2, fontFamily: "Arial, sans-serif" }}>
        news.raakode.dk
      </div>
    </div>
  );
}
