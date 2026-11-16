"use client";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";
import { Providers } from "@/app/providers";
import { resetRealtimeAuthentication } from "@/lib/supabase/browser";
import type { AuthUser, ActiveOrg } from "@/lib/auth/types";
import { userHasPermission, type Permission } from "@/lib/auth/permissions";

interface AuthCtx {
  user: AuthUser;
  activeOrg: ActiveOrg | null;
  isAuthenticated: true;
  refreshing: boolean;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({
  user,
  activeOrg,
  children,
}: {
  user: AuthUser;
  activeOrg: ActiveOrg | null;
  children: ReactNode;
}) {

  useEffect(() => {
    resetRealtimeAuthentication();
    return resetRealtimeAuthentication;
  }, [user.id, activeOrg?.orgId, user.support?.id, user.support?.access_mode]);

  // Revogação/scope no banco também derrubam o snapshot aberto de UI/realtime.
  useEffect(() => {
    if (!user.support) return;
    const expected = `${user.support.id}:${user.support.access_mode}:${user.support.status}`;
    const check = async () => {
      const response = await fetch("/api/v1/auth/support", { cache: "no-store" }).catch(() => null);
      if (!response?.ok) return;
      const result = await response.json();
      if (result.data.signature !== expected) window.location.reload();
    };
    const timer = setInterval(() => {
      void check();
    }, 15000);
    return () => clearInterval(timer);
  }, [user.support]);

  // ⚠️ Havia aqui um `refreshSession()` a cada 40 min no client do browser. Ele
  // nunca renovava nada útil — o cookie é httpOnly, o supabase-js do browser não
  // enxerga a sessão — e, se enxergasse, disputaria o MESMO refresh token com o
  // servidor (refresh concorrente = sessão invalidada). A renovação é do
  // servidor (proxy.ts); o cliente só pergunta via rotas de API.
  const refreshing = false;

  const value = useMemo<AuthCtx>(
    () => ({
      user,
      activeOrg,
      isAuthenticated: true,
      refreshing,
      signOut: async () => {
        resetRealtimeAuthentication();
        const { signOut } = await import("@/app/actions/auth/signOut");
        await signOut();
      },
    }),
    [user, activeOrg, refreshing],
  );

  return (
    <Ctx.Provider value={value}>
      <Providers
        key={`${user.id}:${activeOrg?.orgId ?? "none"}:${user.support?.id ?? "normal"}:${user.support?.access_mode ?? ""}`}
      >
        {children}
      </Providers>
    </Ctx.Provider>
  );
}

export function useAuth(): AuthCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

export function useUser(): AuthUser {
  return useAuth().user;
}

export function useActiveOrg(): ActiveOrg | null {
  return useAuth().activeOrg;
}

export function usePermission(action: Permission): boolean {
  const { user, activeOrg } = useAuth();
  return userHasPermission(user, activeOrg, action);
}
