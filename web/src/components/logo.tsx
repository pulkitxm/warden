export function Logo({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 256 256" className={className} role="img" aria-label="Warden">
      <title>Warden</title>
      <path
        fill="currentColor"
        d="M44 56h34v30h34V42h32v44h34V56h34v96c0 34-27 60-84 88-57-28-84-54-84-88Z"
      />
      <path
        fill="#fff"
        d="M67 84h27v24h27V72h14v36h27V84h27v66c0 25-20 45-64 66-44-21-64-41-64-66Z"
      />
      <path
        fill="none"
        stroke="#4ade80"
        strokeWidth="21"
        strokeLinejoin="miter"
        d="M96 146l23 55 9-22 9 22 23-55"
      />
      <circle fill="currentColor" cx="128" cy="118" r="14" />
      <path fill="currentColor" d="M120 128h16l6 34h-28Z" />
    </svg>
  );
}
