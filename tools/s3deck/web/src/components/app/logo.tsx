export function Logo({ className = 'size-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="7" className="fill-primary" />
      <path d="M8 11.5 16 7l8 4.5-8 4.5-8-4.5Z" className="fill-primary-foreground" />
      <path
        d="m8 16 8 4.5 8-4.5M8 20.5 16 25l8-4.5"
        fill="none"
        className="stroke-primary-foreground"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}
