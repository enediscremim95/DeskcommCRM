/**
 * Prova pela tela do fluxo único de atendimento, desde o primeiro modelo de
 * nicho até publicação e restauração de versão.
 *
 * O teste não cria agente nem versão por API. Os únicos seeds são a conta de
 * login, uma credencial validada de teste e uma sessão de canal, precondições
 * que uma instalação recebe antes de montar o atendimento. Toda configuração,
 * publicação, leitura do resultado e volta de versão acontecem no frontend.
 */
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import { credenciaisSupabaseDeTeste } from "../../scripts/lib/env-de-teste";
import { loginComoMembro } from "./helpers/aguardar-sessao";

const EVIDENCIA = path.join(process.cwd(), "evidence", "atendimento-fluxo-real");
const SENHA = "AtendimentoQa!2026#";
const EMAIL = `atendimento-${randomUUID().slice(0, 8)}@qa.local`;
const supabase = credenciaisSupabaseDeTeste();
const svc = createClient(supabase.url, supabase.serviceRole, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let userId = "";
let orgId = "";

test.use({ locale: "pt-BR", viewport: { width: 1440, height: 1000 } });
test.describe.configure({ timeout: 240_000 });

test.beforeAll(async () => {
  fs.mkdirSync(EVIDENCIA, { recursive: true });

  const { data: criado, error: erroUsuario } = await svc.auth.admin.createUser({
    email: EMAIL,
    password: SENHA,
    email_confirm: true,
  });
  if (erroUsuario || !criado.user) throw erroUsuario ?? new Error("usuário E2E não foi criado");
  userId = criado.user.id;

  const { data: org, error: erroOrg } = await svc
    .from("organizations")
    .insert({
      slug: `atendimento-${randomUUID().slice(0, 8)}`,
      display_name: "Atendimento E2E",
      legal_name: "Atendimento E2E",
      status: "active",
      created_by: userId,
      onboarded_at: new Date().toISOString(),
      settings: { llm: { provider: "anthropic" } },
    })
    .select("id")
    .single();
  if (erroOrg || !org) throw erroOrg ?? new Error("organização E2E não foi criada");
  orgId = org.id as string;

  const { error: erroMembro } = await svc.from("user_organizations").insert({
    organization_id: orgId,
    user_id: userId,
    role: "admin",
    accepted_at: new Date().toISOString(),
  });
  if (erroMembro) throw erroMembro;

  const { error: erroCredencial } = await svc.from("ai_provider_credentials").insert({
    organization_id: orgId,
    provider: "anthropic",
    label: "Atendimento E2E",
    api_key_encrypted: "\\x00",
    api_key_iv: "\\x00",
    api_key_tag: "\\x00",
    api_key_last4: "e2e1",
    is_active: true,
    validated_at: "2026-01-01T00:00:00.000Z",
  } as never);
  if (erroCredencial) throw erroCredencial;

  const { error: erroCanal } = await svc.from("channel_sessions").insert({
    organization_id: orgId,
    waha_session_name: `atendimento-${randomUUID().slice(0, 8)}`,
    display_name: "Número Atendimento E2E",
    webhook_secret_encrypted: "\\x00",
  } as never);
  if (erroCanal) throw erroCanal;
});

test.beforeEach(async ({ page }) => {
  await loginComoMembro(page, EMAIL, SENHA);
});

test.afterAll(async () => {
  if (orgId) {
    await svc.from("ai_agent_runs").delete().eq("organization_id", orgId);
    await svc.from("ai_agent_versions").delete().eq("organization_id", orgId);
    await svc.from("ai_agents").delete().eq("organization_id", orgId);
    await svc.from("channel_sessions").delete().eq("organization_id", orgId);
    await svc.from("ai_provider_credentials").delete().eq("organization_id", orgId);
    await svc.from("user_organizations").delete().eq("organization_id", orgId);
    await svc.from("organizations").delete().eq("id", orgId);
  }
  if (userId) await svc.auth.admin.deleteUser(userId);
});

async function abrirParte(page: Page, nome: string): Promise<void> {
  await page.getByRole("button", { name: nome, exact: true }).first().click();
}

async function abrirTravas(page: Page): Promise<void> {
  await abrirParte(page, "Limites e travas");
  await expect(page.getByTestId("guardrail-horario")).toBeVisible();
}

async function conferirConfiguracao(
  page: Page,
  esperado: {
    abre: string;
    fecha: string;
    umaConversa: boolean;
    handoff: boolean;
  },
): Promise<void> {
  await abrirTravas(page);
  await expect(page.getByLabel("Hora de abertura")).toHaveValue(esperado.abre);
  await expect(page.getByLabel("Hora de fechamento")).toHaveValue(esperado.fecha);
  const umaConversa = page
    .getByTestId("guardrail-uma_conversa")
    .getByRole("switch");
  if (esperado.umaConversa) await expect(umaConversa).toBeChecked();
  else await expect(umaConversa).not.toBeChecked();

  await abrirParte(page, "Quando passa para humano");
  const handoff = page.getByRole("switch");
  if (esperado.handoff) await expect(handoff).toBeChecked();
  else await expect(handoff).not.toBeChecked();
}

test("um leigo monta, publica, confirma o gravado e volta à versão anterior", async ({
  page,
}) => {
  await page.goto("/app/ai/atendimento");
  await expect(page.getByText("Começar pelo modelo do nicho", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Clínica e agenda", exact: true }).click();

  await abrirTravas(page);
  const ids = [
    "opt_out",
    "humano_em_atendimento",
    "horario",
    "ritmo_humano",
    "uma_conversa",
    "teto_diario",
    "sem_inventar",
  ] as const;
  for (const id of ids) {
    await expect(page.getByTestId(`guardrail-${id}`)).toBeVisible();
  }
  for (const id of ["horario", "ritmo_humano", "uma_conversa", "teto_diario"] as const) {
    await expect(page.getByTestId(`guardrail-${id}`).getByRole("switch")).toBeChecked();
  }

  const medidas = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLElement>("[data-testid='atendimento-flow-canvas']");
    const painel = document.querySelector<HTMLElement>("[data-testid='atendimento-config-panel']");
    if (!canvas || !painel) throw new Error("canvas ou painel de configuração não apareceu");
    const c = canvas.getBoundingClientRect();
    const p = painel.getBoundingClientRect();
    const estilo = getComputedStyle(painel);
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      canvas: { x: c.x, width: c.width, height: c.height },
      painel: { x: p.x, width: p.width, height: p.height, position: estilo.position },
      painelDepoisDoCanvas: p.x >= c.x + c.width - 2,
      canvasSemOverflowHorizontal: canvas.scrollWidth <= canvas.clientWidth,
    };
  });
  expect(medidas.canvas.width).toBeGreaterThan(500);
  expect(medidas.painel.width).toBeGreaterThanOrEqual(360);
  expect(medidas.painelDepoisDoCanvas).toBe(true);
  expect(medidas.canvasSemOverflowHorizontal).toBe(true);
  fs.writeFileSync(
    path.join(EVIDENCIA, "01-medidas-layout.json"),
    `${JSON.stringify(medidas, null, 2)}\n`,
  );
  await page.screenshot({
    path: path.join(EVIDENCIA, "01-travas-ligadas.png"),
    fullPage: true,
  });

  await page.getByLabel("Hora de abertura").fill("9");
  await page.getByLabel("Hora de fechamento").fill("17");
  await page
    .getByTestId("guardrail-uma_conversa")
    .getByRole("switch")
    .click();

  const confirmacao = page.getByRole("alertdialog");
  await expect(confirmacao).toBeVisible();
  await expect(confirmacao).toContainText(
    "Ao desligar, o mesmo número poderá conduzir várias conversas ao mesmo tempo.",
  );
  await expect(confirmacao).toContainText(
    "A decisão ficará registrada quando o rascunho for salvo.",
  );
  await page.screenshot({
    path: path.join(EVIDENCIA, "02-confirmacao-com-consequencia.png"),
    fullPage: true,
  });
  await confirmacao
    .getByRole("button", { name: "Entendo a consequência e quero desligar" })
    .click();

  await abrirParte(page, "Quando passa para humano");
  await page.getByRole("switch").click();
  await expect(page.getByRole("switch")).not.toBeChecked();

  await page.getByRole("button", { name: "Publicar", exact: true }).click();
  await expect(page.getByText("Atendimento publicado.", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText("Publicado", { exact: true }).first()).toBeVisible({
    timeout: 30_000,
  });
  await page.reload();
  await expect(page.getByText("Publicado", { exact: true }).first()).toBeVisible();
  await conferirConfiguracao(page, {
    abre: "9",
    fecha: "17",
    umaConversa: false,
    handoff: false,
  });

  await abrirTravas(page);
  await page.getByLabel("Hora de abertura").fill("10");
  await page.getByLabel("Hora de fechamento").fill("19");
  await page
    .getByTestId("guardrail-uma_conversa")
    .getByRole("switch")
    .click();
  await expect(
    page.getByTestId("guardrail-uma_conversa").getByRole("switch"),
  ).toBeChecked();
  await abrirParte(page, "Quando passa para humano");
  await page.getByRole("switch").click();
  await expect(page.getByRole("switch")).toBeChecked();

  await page.getByRole("button", { name: "Publicar", exact: true }).click();
  await expect(page.getByText("Atendimento publicado.", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await page.reload();
  await expect(page.getByText("Publicado", { exact: true }).first()).toBeVisible();
  await conferirConfiguracao(page, {
    abre: "10",
    fecha: "19",
    umaConversa: true,
    handoff: true,
  });
  await page.screenshot({
    path: path.join(EVIDENCIA, "03-segunda-versao-publicada.png"),
    fullPage: true,
  });

  const historico = page.getByLabel("Histórico de versões");
  await historico.click();
  await expect(page.getByRole("option", { name: "v2", exact: true })).toBeVisible();
  await page.getByRole("option", { name: "v1", exact: true }).click();
  await page.getByRole("button", { name: "Voltar", exact: true }).click();
  await expect(
    page.getByText("Versão anterior restaurada e publicada.", { exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  await page.reload();
  await expect(page.getByText("Publicado", { exact: true }).first()).toBeVisible();
  await conferirConfiguracao(page, {
    abre: "9",
    fecha: "17",
    umaConversa: false,
    handoff: false,
  });
  await page.screenshot({
    path: path.join(EVIDENCIA, "04-versao-anterior-restaurada.png"),
    fullPage: true,
  });
});
