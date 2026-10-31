import {
  Activity,
  Boxes,
  ChevronRight,
  Gauge,
  Globe,
  LogOut,
  Menu,
  Moon,
  Plus,
  ScrollText,
  Settings,
  Sun,
  User as UserIcon,
  Users,
  WifiOff,
  X,
} from "lucide-react";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { CreeperIcon } from "@/components/CreeperIcon";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/overlays";
import { useAuth } from "@/hooks/auth";
import { useConnected, useLiveSync, useServers } from "@/hooks/servers";
import { useTheme } from "@/hooks/useTheme";
import { useI18n } from "@/lib/i18n";
import type { ServerStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface Crumb {
  label: string;
  to?: string;
}

const CrumbContext = createContext<(c: Crumb[]) => void>(() => undefined);

/** Pages declare their breadcrumb trail: useCrumbs([{label: "Серверы", to: "/"}, {label: name}]). */
export function useCrumbs(crumbs: Crumb[]): void {
  const set = useContext(CrumbContext);
  const key = JSON.stringify(crumbs);
  useEffect(() => set(JSON.parse(key) as Crumb[]), [key, set]);
}

const DOT: Record<ServerStatus, string> = {
  online: "bg-success",
  starting: "bg-warning animate-pulse-dot",
  stopping: "bg-warning animate-pulse-dot",
  installing: "bg-sky-500 animate-pulse-dot",
  crashed: "bg-destructive",
  offline: "bg-muted-foreground/50",
};

function NavItem({ to, icon, label, end, onClick }: { to: string; icon: ReactNode; label: string; end?: boolean; onClick?: () => void }) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onClick}
      className={({ isActive }) =>
        cn(
          "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors [&_svg]:size-4 [&_svg]:shrink-0",
          isActive ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground",
        )
      }
    >
      {icon}
      <span className="truncate">{label}</span>
    </NavLink>
  );
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useI18n();
  const { user, settings } = useAuth();
  const servers = useServers();
  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto p-4 scrollbar-thin">
      <Link to="/" onClick={onNavigate} className="flex items-center gap-2.5 px-2 pt-1">
        <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <CreeperIcon className="size-5" />
        </div>
        <span className="text-[15px] font-semibold tracking-tight">{settings?.panelName ?? "MC Panel"}</span>
      </Link>

      <nav className="space-y-1">
        <NavItem to="/" end icon={<Boxes />} label={t("nav.servers")} onClick={onNavigate} />
        <NavItem to="/servers/new" icon={<Plus />} label={t("nav.newServer")} onClick={onNavigate} />
        <NavItem to="/account" icon={<UserIcon />} label={t("nav.account")} onClick={onNavigate} />
      </nav>

      {servers.data && servers.data.length > 0 && (
        <div className="space-y-1">
          <p className="px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">{t("nav.servers")}</p>
          {servers.data.map((s) => (
            <NavLink
              key={s.id}
              to={`/servers/${s.id}`}
              onClick={onNavigate}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-lg px-3 py-1.5 text-sm transition-colors",
                  isActive ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )
              }
            >
              <span className={cn("size-2 shrink-0 rounded-full", DOT[s.status])} />
              <span className="truncate">{s.name}</span>
            </NavLink>
          ))}
        </div>
      )}

      {user?.role === "admin" && (
        <div className="space-y-1">
          <p className="px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">{t("nav.admin")}</p>
          <NavItem to="/admin" end icon={<Gauge />} label={t("nav.adminOverview")} onClick={onNavigate} />
          <NavItem to="/admin/users" icon={<Users />} label={t("nav.adminUsers")} onClick={onNavigate} />
          <NavItem to="/admin/audit" icon={<Activity />} label={t("nav.adminAudit")} onClick={onNavigate} />
          <NavItem to="/admin/logs" icon={<ScrollText />} label={t("nav.adminLogs")} onClick={onNavigate} />
          <NavItem to="/admin/settings" icon={<Settings />} label={t("nav.adminSettings")} onClick={onNavigate} />
        </div>
      )}
    </div>
  );
}

function UserMenu() {
  const { t, locale, setLocale } = useI18n();
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  if (!user) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-2 rounded-full p-0.5 pr-2 transition-colors hover:bg-accent">
          <span className="flex size-8 items-center justify-center rounded-full bg-primary/15 text-sm font-semibold uppercase text-primary">
            {user.username.slice(0, 1)}
          </span>
          <span className="hidden text-sm font-medium sm:inline">{user.username}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{user.role === "admin" ? "Администратор" : "Пользователь"}</DropdownMenuLabel>
        <DropdownMenuItem asChild>
          <Link to="/account">
            <UserIcon /> {t("nav.account")}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={(e) => (e.preventDefault(), toggle())}>
          {theme === "dark" ? <Sun /> : <Moon />} {t("nav.theme")}: {theme === "dark" ? t("nav.themeDark") : t("nav.themeLight")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={(e) => (e.preventDefault(), setLocale(locale === "ru" ? "en" : "ru"))}>
          <Globe /> {t("nav.language")}: {locale === "ru" ? "Русский" : "English"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem destructive onSelect={() => void logout()}>
          <LogOut /> {t("nav.logout")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppShell() {
  const [crumbs, setCrumbs] = useState<Crumb[]>([]);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { theme, toggle } = useTheme();
  const connected = useConnected();
  const location = useLocation();
  useLiveSync();
  useEffect(() => setMobileOpen(false), [location.pathname]);

  return (
    <CrumbContext.Provider value={setCrumbs}>
      <div className="flex min-h-dvh">
        <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 border-r bg-sidebar lg:block">
          <Sidebar />
        </aside>

        {mobileOpen && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-in fade-in-0" onClick={() => setMobileOpen(false)} />
            <aside className="absolute inset-y-0 left-0 w-72 border-r bg-sidebar shadow-2xl animate-in slide-in-from-left">
              <button className="absolute right-3 top-4 rounded-md p-1.5 text-muted-foreground hover:bg-accent" onClick={() => setMobileOpen(false)} aria-label="Закрыть меню">
                <X className="size-5" />
              </button>
              <Sidebar onNavigate={() => setMobileOpen(false)} />
            </aside>
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur-md sm:px-6">
            <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Открыть меню">
              <Menu />
            </Button>
            <nav className="flex min-w-0 flex-1 items-center gap-1.5 text-sm" aria-label="Хлебные крошки">
              {crumbs.map((c, i) => (
                <span key={i} className="flex min-w-0 items-center gap-1.5">
                  {i > 0 && <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/60" />}
                  {c.to && i < crumbs.length - 1 ? (
                    <Link to={c.to} className="truncate text-muted-foreground transition-colors hover:text-foreground">
                      {c.label}
                    </Link>
                  ) : (
                    <span className="truncate font-medium">{c.label}</span>
                  )}
                </span>
              ))}
            </nav>
            {!connected && (
              <span className="hidden items-center gap-1.5 rounded-full bg-warning/15 px-2.5 py-1 text-xs font-medium text-warning sm:flex">
                <WifiOff className="size-3.5" /> Переподключение…
              </span>
            )}
            <Button variant="ghost" size="icon" onClick={toggle} aria-label="Сменить тему">
              {theme === "dark" ? <Sun /> : <Moon />}
            </Button>
            <UserMenu />
          </header>
          <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:py-8">
            <Outlet />
          </main>
        </div>
      </div>
    </CrumbContext.Provider>
  );
}

export function PageHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0 space-y-1">
        <h1 className="truncate text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
