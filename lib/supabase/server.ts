import { ehAuthRecusada } from "@/lib/auth/get-user-com-backoff";
/**
 * Supabase client para Server Components, Route Handlers e Server Actions.
 *
 * Lê/escreve cookies via next/headers. Sempre use `getUser()` (valida JWT no
 * backend), NUNCA `getSession()` (confia no cookie local sem revalidar).
 */

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookieSecure } from "@/lib/supabase/cookie-secure";
import { cookies } from "next/headers";
import { env } from "@/lib/env";

export async function createClient() {
  const cookieStore = await cookies();

  let validando = false;
  let pendentes: { name: string; value: string; options: CookieOptions }[] = [];
  const client = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        if (validando) {
          pendentes.push(...cookiesToSet);
          return;
        }
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // setAll pode ser chamado de Server Component; nesse caso, ignoramos.
          // Refresh de sessão acontece no middleware do Next.
        }
      },
    },
    // D-01.01: cookie name canônico alinhado ao middleware.
    cookieOptions: {
      name: "sb-deskcomm-auth",
      sameSite: "strict",
      httpOnly: true,
      secure: cookieSecure(),
      path: "/",
    },
  });
  const getUser = client.auth.getUser.bind(client.auth);
  client.auth.getUser = async (...args) => {
    validando = true;
    pendentes = [];
    try {
      const resultado = await getUser(...args);
      if (!resultado.error || ehAuthRecusada(resultado.error)) {
        try {
          for (const { name, value, options } of pendentes) cookieStore.set(name, value, options);
        } catch {
          // Server Component não pode escrever cookies.
        }
      }
      return resultado;
    } finally {
      validando = false;
      pendentes = [];
    }
  };
  return client;
}
