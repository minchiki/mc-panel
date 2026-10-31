/** Creeper face, same shape as the favicon. Used as the panel logo. */
export function CreeperIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="8 8.5 16 16" className={className} fill="currentColor" aria-hidden="true">
      <path d="M8 9h6v6H8zM18 9h6v6h-6zM13 15h6v3h3v6h-3v-3h-6v3h-3v-6h3z" />
    </svg>
  );
}
