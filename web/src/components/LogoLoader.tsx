import { Logo } from "@/components/Logo";

/** Full-page loading state: the logo gently floating. Same markup as the splash in index.html. */
export function LogoLoader() {
  return (
    <div className="boot-splash" role="status" aria-label="Загрузка">
      <Logo className="logo-bob size-16 drop-shadow-[0_6px_16px_hsl(var(--primary)/0.35)]" />
    </div>
  );
}
