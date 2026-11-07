export function GoldNugget({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={`nugget-icon ${className}`}>
      <path className="nugget" d="M4 15 C3 11 6 7 10 7 C12 4 17 5 18 8 C21 9 22 13 20 16 C18 19 8 20 4 15 Z" />
      <ellipse className="shine" cx="10" cy="10.5" rx="2" ry="1" opacity="0.55" />
    </svg>
  );
}
