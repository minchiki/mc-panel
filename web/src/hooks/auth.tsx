import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, type ReactNode } from "react";
import { ApiError, get, post } from "@/lib/api";
import type { PublicSettings, User } from "@/lib/types";
import { applyAccent } from "@/lib/utils";
import { socket } from "@/lib/ws";

interface AuthValue {
  user: User | null;
  loading: boolean;
  settings: PublicSettings | undefined;
  refresh: () => Promise<unknown>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const me = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      try {
        return (await get<{ user: User }>("/api/auth/me")).user;
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: 60_000,
  });
  const settings = useQuery({ queryKey: ["public-settings"], queryFn: () => get<PublicSettings>("/api/public-settings"), staleTime: 300_000 });

  useEffect(() => {
    if (settings.data?.accentColor) applyAccent(settings.data.accentColor);
    if (settings.data?.panelName) document.title = settings.data.panelName;
  }, [settings.data]);

  useEffect(() => {
    if (me.data) socket.start();
    else socket.stop();
  }, [me.data]);

  useEffect(() => {
    const onUnauthorized = () => qc.setQueryData(["me"], null);
    window.addEventListener("mcp:unauthorized", onUnauthorized);
    return () => window.removeEventListener("mcp:unauthorized", onUnauthorized);
  }, [qc]);

  const value: AuthValue = {
    user: me.data ?? null,
    loading: me.isLoading,
    settings: settings.data,
    refresh: () => me.refetch(),
    logout: async () => {
      await post("/api/auth/logout").catch(() => undefined);
      socket.stop();
      qc.clear();
      qc.setQueryData(["me"], null);
    },
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}
