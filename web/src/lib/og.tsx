import { ImageResponse } from "next/og";

export const OG_SIZE = { width: 1200, height: 630 };
export const OG_CONTENT_TYPE = "image/png";

const NAVY = "#0b1020";
const CORAL = "#ff6b5b";
const MINT = "#4fd1a5";
const FOG = "#8f9ab5";

const MARK = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">` +
    `<path fill="#ffffff" d="M44 56h34v30h34V42h32v44h34V56h34v96c0 34-27 60-84 88-57-28-84-54-84-88Z"/>` +
    `<path fill="#0b1020" d="M67 84h27v24h27V72h14v36h27V84h27v66c0 25-20 45-64 66-44-21-64-41-64-66Z"/>` +
    `<path fill="none" stroke="#4fd1a5" stroke-width="21" stroke-linejoin="miter" d="M96 146l23 55 9-22 9 22 23-55"/>` +
    `<circle fill="#ffffff" cx="128" cy="118" r="14"/>` +
    `<path fill="#ffffff" d="M120 128h16l6 34h-28Z"/>` +
    `</svg>`,
)}`;

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;
}

export function ogImage(options: { label: string; title: string; subtitle?: string }) {
  const { label, title, subtitle } = options;
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        background: NAVY,
        backgroundImage: `radial-gradient(1000px 500px at 88% -12%, rgba(79,209,165,0.22), transparent), radial-gradient(760px 420px at 4% 108%, rgba(255,107,91,0.20), transparent)`,
        padding: 72,
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        {/* biome-ignore lint/performance/noImgElement: satori renders this, next/image is unavailable */}
        <img src={MARK} width={40} height={40} alt="" />
        <div style={{ color: "#ffffff", fontSize: 32, fontWeight: 700, letterSpacing: -0.5 }}>
          Warden
        </div>
        <div style={{ color: FOG, fontSize: 26, display: "flex" }}>·</div>
        <div style={{ color: MINT, fontSize: 26, letterSpacing: 0.4 }}>{truncate(label, 40)}</div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
        <div
          style={{
            color: "#ffffff",
            fontSize: title.length > 34 ? 66 : 82,
            fontWeight: 700,
            lineHeight: 1.05,
            letterSpacing: -2,
            display: "flex",
          }}
        >
          {truncate(title, 76)}
        </div>
        {subtitle ? (
          <div style={{ color: FOG, fontSize: 30, lineHeight: 1.35, display: "flex" }}>
            {truncate(subtitle, 120)}
          </div>
        ) : null}
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ color: FOG, fontSize: 24, display: "flex" }}>warden.pulkit.page</div>
        <div style={{ display: "flex", gap: 10 }}>
          <div
            style={{ width: 54, height: 6, borderRadius: 3, background: CORAL, display: "flex" }}
          />
          <div
            style={{ width: 54, height: 6, borderRadius: 3, background: MINT, display: "flex" }}
          />
        </div>
      </div>
    </div>,
    { ...OG_SIZE },
  );
}
