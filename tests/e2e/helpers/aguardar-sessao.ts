import { expect, type Page } from "@playwright/test";

type NivelDeGarantia = "aal1" | "aal2";

function nivelDoToken(token: string): string | null {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString()) as {
      aal?: string;
    };
    return payload.aal ?? null;
  } catch {
    return null;
  }
}

/**
 * Espera o login terminar de verdade.
 *
 * A URL sozinha não basta: `/login/mfa?next=/app/inbox` contém o destino e,
 * mesmo depois de entrar em `/app`, o App Router ainda pode estar concluindo a
 * navegação. A rota do token chama `getUser()` no servidor, portanto o 200
 * prova que o cookie já chegou e que o JWT é válido. O claim `aal` prova o
 * segundo fator quando o cenário exige AAL2.
 */
export async function aguardarSessaoCompleta(
  page: Page,
  nivelEsperado?: NivelDeGarantia,
): Promise<void> {
  await page.waitForURL(
    (url) =>
      !url.pathname.startsWith("/login") &&
      (url.pathname === "/app" || url.pathname.startsWith("/app/")),
    { timeout: 60_000 },
  );

  await expect
    .poll(
      async () => {
        const response = await page.request.get("/api/v1/auth/realtime-token", {
          failOnStatusCode: false,
        });
        if (!response.ok()) return false;
        const body = (await response.json()) as { data?: { access_token?: string } };
        const token = body.data?.access_token;
        if (!token) return false;
        const nivel = nivelDoToken(token);
        return nivelEsperado ? nivel === nivelEsperado : nivel === "aal1" || nivel === "aal2";
      },
      { timeout: 60_000, message: "a sessão autenticada não ficou disponível no servidor" },
    )
    .toBe(true);

  // O token já é válido; agora apenas deixa o documento autenticado terminar
  // antes que o teste escolha a tela que realmente quer exercitar.
  await page.waitForLoadState("load");
}
