import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import { test, expect, type Page } from "@playwright/test";

/**
 * TROCA DE ORGANIZAÇÃO EM SEQUÊNCIA — a regressão de "fica mais lenta a cada
 * troca", de "cai em tela branca" e de "o link Relatório às vezes não responde".
 *
 * Um usuário em OITO organizações troca entre todas, várias rodadas seguidas.
 * Em cada troca a spec mede o tempo até a casca estar de pé na organização nova
 * e, a seguir, clica no "Relatório" do menu lateral. Reprova se:
 *
 *   - alguma troca passar do teto absoluto (hoje, em produção, passa de 40 s);
 *   - a média da última rodada passar da média da primeira por mais que a
 *     tolerância — a lentidão que CRESCE é o defeito, não o custo de uma troca;
 *   - a tela ficar em branco (sem seletor, sem conteúdo principal);
 *   - o clique em "Relatório" não levar a /app/relatorio;
 *   - o número de requisições de autenticação por troca crescer (acúmulo de
 *     assinaturas, timers ou refresh de sessão em laço no cliente).
 */
const RAIZ = path.resolve(__dirname, "../..");
const RODADAS = 4;
/** Teto de UMA troca. O build local responde em segundos; 20 s já é falha. */
const TETO_POR_TROCA_MS = 20_000;
/** A última rodada pode custar no máximo isto × a primeira (+ folga fixa). */
const FATOR_DE_CRESCIMENTO = 1.6;
const FOLGA_MS = 1_500;

interface Org { id: string; nome: string }
interface Creds { password: string; users: Record<string, { email: string } | undefined>; oito_orgs?: { orgs: Org[] } }

function lerCreds(): Creds & { oito_orgs: { orgs: Org[] } } {
  const p = path.join(RAIZ, ".e2e-creds.json");
  if (!fs.existsSync(p)) throw new Error("`.e2e-creds.json` ausente — rode `scripts/seed-e2e-credentials.ts`");
  let c = JSON.parse(fs.readFileSync(p, "utf8")) as Creds;
  if (!c.oito_orgs) {
    execFileSync("npx", ["tsx", "scripts/seed-e2e-oito-organizacoes.ts"], { stdio: "inherit" });
    c = JSON.parse(fs.readFileSync(p, "utf8")) as Creds;
  }
  if (!c.oito_orgs || c.oito_orgs.orgs.length < 8) throw new Error("o seed não deixou 8 organizações");
  return c as Creds & { oito_orgs: { orgs: Org[] } };
}

async function entrar(page: Page, creds: Creds) {
  const usuario = creds.users.manager;
  if (!usuario) throw new Error(".e2e-creds.json sem o usuário `manager`");
  await page.goto("/login");
  await page.getByLabel(/e-?mail/i).fill(usuario.email);
  await page.getByLabel(/senha/i).fill(creds.password);
  await page.getByRole("button", { name: /entrar/i }).click();
  await page.waitForURL(/\/app(\/|$)/, { timeout: 30_000 });
}

/** Tela branca = sem seletor E sem conteúdo principal com algum texto. */
async function assertNaoEmBranco(page: Page, contexto: string) {
  await expect(page.getByTestId("tenant-switcher"), `${contexto}: tela em branco (sem seletor de organização)`)
    .toBeVisible({ timeout: TETO_POR_TROCA_MS });
  const principal = page.locator("#conteudo-principal");
  await expect(principal, `${contexto}: sem conteúdo principal`).toBeVisible();
  const texto = ((await principal.innerText()) ?? "").trim();
  expect(texto.length, `${contexto}: conteúdo principal vazio`).toBeGreaterThan(0);
}

const media = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

test.describe.configure({ timeout: 600_000 });

test("trocar entre 8 organizações várias vezes não fica mais lento, não abre tela branca e o Relatório navega", async ({ page }) => {
  const creds = lerCreds();
  const orgs = creds.oito_orgs.orgs;
  await entrar(page, creds);
  await page.goto("/app/kanban");
  await assertNaoEmBranco(page, "entrada");

  const authReqs: string[] = [];
  page.on("request", (r) => {
    if (/\/api\/v1\/auth\/(realtime-token|interface)/.test(r.url())) authReqs.push(r.url());
  });

  const porRodada: number[][] = [];
  const reqsPorTroca: number[] = [];
  const nomes = new Map<string, string>();

  for (let rodada = 0; rodada < RODADAS; rodada++) {
    const tempos: number[] = [];
    // Ordem diferente a cada rodada: a regressão não pode depender da sequência.
    const ordem = rodada % 2 === 0 ? orgs : [...orgs].reverse();
    for (const org of ordem) {
      const seletor = page.getByTestId("tenant-switcher");
      const atual = ((await seletor.textContent()) ?? "").trim();
      if (nomes.get(org.id) && atual === nomes.get(org.id)) continue; // já é a ativa
      const antes = authReqs.length;
      await seletor.click();
      const item = page.getByTestId(`tenant-switcher-item-${org.id}`);
      await expect(item).toBeVisible();
      const t0 = Date.now();
      await item.click();
      await page.waitForURL(/\/app\/(pipelines|kanban)/, { timeout: TETO_POR_TROCA_MS });
      await expect(page.getByTestId("tenant-switcher")).toBeEnabled({ timeout: TETO_POR_TROCA_MS });
      await expect(page.getByTestId("organization-transition")).toHaveCount(0);
      const dt = Date.now() - t0;
      const contexto = `rodada ${rodada + 1}, org ${org.id}`;
      await assertNaoEmBranco(page, contexto);
      nomes.set(org.id, ((await page.getByTestId("tenant-switcher").textContent()) ?? "").trim());
      expect(dt, `${contexto}: a troca levou ${dt} ms (teto ${TETO_POR_TROCA_MS} ms)`).toBeLessThan(TETO_POR_TROCA_MS);
      tempos.push(dt);

      // O Relatório do menu lateral tem de navegar — sempre, em toda org.
      const relatorio = page.getByRole("navigation", { name: /navegação principal/i }).getByRole("link", { name: "Relatório" });
      await expect(relatorio, `${contexto}: sem link Relatório no menu`).toBeVisible();
      await relatorio.click();
      await page.waitForURL(/\/app\/relatorio/, { timeout: TETO_POR_TROCA_MS });
      await expect(page.getByRole("heading", { name: "Relatório" }).first(), `${contexto}: Relatório não abriu`)
        .toBeVisible({ timeout: TETO_POR_TROCA_MS });
      await assertNaoEmBranco(page, `${contexto} (relatório)`);
      reqsPorTroca.push(authReqs.length - antes);
    }
    porRodada.push(tempos);
  }

  const primeira = media(porRodada[0]!);
  const ultima = media(porRodada[porRodada.length - 1]!);
  const resumo = porRodada.map((r, i) => `r${i + 1}=${Math.round(media(r))}ms`).join(" ");
  console.info(`[troca-em-sequencia] ${resumo} | requisições de auth por troca: ${reqsPorTroca.join(",")}`);
  expect(
    ultima,
    `a troca ficou mais lenta com o uso: ${resumo}`,
  ).toBeLessThanOrEqual(primeira * FATOR_DE_CRESCIMENTO + FOLGA_MS);

  // Acúmulo no cliente aparece como mais chamadas de auth por troca. Cada troca é
  // um documento novo; o número tem de se manter na faixa da primeira metade.
  const metade = Math.floor(reqsPorTroca.length / 2);
  const inicio = media(reqsPorTroca.slice(0, metade));
  const fim = media(reqsPorTroca.slice(metade));
  expect(fim, `requisições de auth por troca cresceram: ${reqsPorTroca.join(",")}`).toBeLessThanOrEqual(inicio + 2);
});

/**
 * O gatilho real do "Autenticação temporariamente indisponível": o token de
 * acesso VENCEU (1 h) e várias requisições chegam juntas — proxy, layout, página
 * e prefetch dos links. O servidor tem de renovar UMA vez, entregar o cookie novo
 * ao render e seguir; nunca pedir login, travar nem mostrar a tela de erro.
 */
async function vencerTokenDeAcesso(page: Page) {
  const contexto = page.context();
  const cookies = (await contexto.cookies()).filter((c) => c.name.startsWith("sb-deskcomm-auth"));
  expect(cookies.length, "sem cookie de sessão para vencer").toBeGreaterThan(0);
  const ordenados = [...cookies].sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));
  const juntos = ordenados.map((c) => c.value).join("");
  expect(juntos.startsWith("base64-")).toBe(true);
  const sessao = JSON.parse(Buffer.from(juntos.slice("base64-".length), "base64url").toString("utf8"));
  sessao.expires_at = 1;
  const novo = "base64-" + Buffer.from(JSON.stringify(sessao), "utf8").toString("base64url");
  const base = ordenados[0]!;
  await contexto.clearCookies({ name: /^sb-deskcomm-auth/ });
  await contexto.addCookies([{ name: "sb-deskcomm-auth", value: novo, domain: base.domain, path: "/", httpOnly: true, sameSite: "Strict", secure: base.secure }]);
}

test("token de acesso vencido: abrir /app/relatorio direto e clicar no menu renova uma vez e não cai em erro", async ({ page }) => {
  const creds = lerCreds();
  await entrar(page, creds);
  await vencerTokenDeAcesso(page);
  await page.goto("/app/relatorio");
  await expect(page, "caiu no login com sessão renovável").toHaveURL(/\/app\/relatorio/);
  await expect(page.getByTestId("autenticacao-indisponivel")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Relatório" }).first()).toBeVisible({ timeout: 20_000 });
  await assertNaoEmBranco(page, "relatório com token vencido");

  await vencerTokenDeAcesso(page);
  await page.getByRole("navigation", { name: /navegação principal/i }).getByRole("link", { name: "Relatório" }).click();
  await page.waitForURL(/\/app\/relatorio/, { timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "Relatório" }).first()).toBeVisible({ timeout: 20_000 });
});
