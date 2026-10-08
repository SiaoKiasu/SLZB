export function LindenMark({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <path d="M12 11h13v2h-4v24h10l5-9h2l-2 12H12v-2h4V13h-4z" fill="currentColor" />
      <path d="M26 22C25 13 31 7 40 7c0 9-5 15-14 15Z" stroke="currentColor" strokeWidth="1.4" />
      <path d="m25 25 10-13" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

export function LindenBrand({ className = "" }: { className?: string }) {
  return (
    <span className={`brand ${className}`}>
      <span className="brand-mark">
        <LindenMark />
      </span>
      <span className="brand-type">
        <span className="brand-name">Linden</span>
        <span className="brand-sub">Asset Management</span>
      </span>
    </span>
  );
}
