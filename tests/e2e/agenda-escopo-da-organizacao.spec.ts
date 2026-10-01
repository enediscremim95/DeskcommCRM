import { randomUUID } from "node:crypto";
import type * as PlaywrightTestTypes from "@playwright/test";

import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import { credenciaisSupabaseDeTeste } from "../../scripts/lib/env-de-teste";
import { aguardarSessaoCompleta, loginComoMembro } from "./helpers/aguardar-sessao";

/**
 * A AGENDA MOSTRA A ORGANIZAÇÃO ATIVA — e só ela.
 *
 * ─── O defeito que esta spec prende ──────────────────────────────────────────
 * O dono do produto instalou a v1.7.0 na VPS dele, abriu a Agenda e viu SEIS
 * tipos de agendamento onde há três. Clicar em metade deles devolvia
 * "Tipo de agendamento não encontrado. ID: <uuid>".
 *
 * Não havia duplicata nenhuma no banco. Ele é admin de DUAS organizações na
 * mesma instalação, e `app/app/agenda/page.tsx` consultava `calendar_event_types`
 * e `calendar_appointments` sem filtrar `organization_id`, confiando só na RLS.
 * A `fn_user_org_ids()` que as policies usam devolve TODAS as organizações do
 * usuário: ela é PISO (impede vazamento entre inquilinos), não ESCOPO (não
 * escolhe a org ativa). O erro "não encontrado" era a consequência — a rota que
 * marca escapa a org corretamente e não achava o tipo que esta tela ofereceu.
 *
 * ─── Por que a asserção é sobre NOMES, não sobre contagem ────────────────────
 * A org B também recebe tipos semeados no provisionamento, com os MESMOS nomes
 * da org A. Contar chips passaria com o código quebrado; só o conjunto de nomes
 * distingue "a org certa" de "as duas somadas".
 *
 * Toda a suíte até aqui roda com usuário de UMA organização — um cenário de uma
 * org não consegue, por construção, enxergar este defeito. Por isso este caso
 * cria seu próprio usuário e suas duas organizações, sem alterar o fixture comum.
 */
// Login + duas travessias da Agenda + troca de organização.
test.describe.configure({ timeout: 150_000 });

const SENHA = "AgendaEscopoQa!2026#";
const EMAIL = `agenda-escopo-${randomUUID().slice(0, 8)}@qa.local`;
const supabase = credenciaisSupabaseDeTeste();
const svc = createClient(supabase.url, supabase.serviceRole, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let userId = "";
const orgIds: string[] = [];
let duasOrgs: DuasOrgs | null = null;

interface DuasOrgs {
  org_a_id: string;
  org_a_nome: string;
  org_b_id: string;
  org_b_nome: string;
  tipo_a: { slug: string; nome: string; id: string };
  tipo_b: { slug: string; nome: string; id: string };
}

async function criarOrganizacao(nome: string, prefixo: string): Promise<string> {
  const { data, error } = await svc
    .from("organizations")
    .insert({
      slug: `${prefixo}-${randomUUID().slice(0, 8)}`,
      display_name: nome,
      legal_name: nome,
      timezone: "America/Sao_Paulo",
      locale: "pt-BR",
      status: "active",
      created_by: userId,
      onboarded_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error(`organização ${nome} não foi criada`);
  const id = data.id as string;
  orgIds.push(id);
  return id;
}

async function criarTipo(orgId: string, tipo: { slug: string; nome: string }): Promise<string> {
  const { data, error } = await svc
    .from("calendar_event_types")
    .insert({
      organization_id: orgId,
      name: tipo.nome,
      slug: tipo.slug,
      description: "Tipo exclusivo desta organização, usado pela spec de escopo.",
      duration_minutes: 30,
      minimum_notice_minutes: 60,
      booking_window_days: 60,
      is_active: true,
      default_owner_user_id: userId,
    } as never)
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error(`tipo ${tipo.slug} não foi criado`);
  return (data as { id: string }).id;
}

test.beforeAll(async () => {
  const { data: criado, error: erroUsuario } = await svc.auth.admin.createUser({
    email: EMAIL,
    password: SENHA,
    email_confirm: true,
  });
  if (erroUsuario || !criado.user) throw erroUsuario ?? new Error("usuário E2E não foi criado");
  userId = criado.user.id;

  // Esta spec precisa de um usuário em duas organizações, mas não precisa usar
  // o `manager` nem a organização compartilhados pela suíte. O fixture anterior
  // acrescentava na org comum um tipo cujo dono não tinha jornada; como o tipo
  // virava o primeiro em ordem alfabética, as specs seguintes abriam o painel
  // nele e recebiam 422 antes de chegar ao tipo com disponibilidade publicada.
  const orgAId = await criarOrganizacao("Agenda Escopo E2E A", "agenda-escopo-a");
  const orgBId = await criarOrganizacao("Agenda Escopo E2E B", "agenda-escopo-b");

  const aceitoEm = new Date().toISOString();
  const { error: erroMembros } = await svc.from("user_organizations").insert([
    { organization_id: orgAId, user_id: userId, role: "manager", accepted_at: aceitoEm },
    { organization_id: orgBId, user_id: userId, role: "manager", accepted_at: aceitoEm },
  ] as never);
  if (erroMembros) throw erroMembros;

  const tipoA = {
    slug: `so-da-org-a-${randomUUID().slice(0, 8)}`,
    nome: "Atendimento Só Da Org A",
  };
  const tipoB = {
    slug: `so-da-org-b-${randomUUID().slice(0, 8)}`,
    nome: "Atendimento Só Da Org B",
  };
  const tipoAId = await criarTipo(orgAId, tipoA);
  const tipoBId = await criarTipo(orgBId, tipoB);

  duasOrgs = {
    org_a_id: orgAId,
    org_a_nome: "Agenda Escopo E2E A",
    org_b_id: orgBId,
    org_b_nome: "Agenda Escopo E2E B",
    tipo_a: { ...tipoA, id: tipoAId },
    tipo_b: { ...tipoB, id: tipoBId },
  };
});

test.afterAll(async () => {
  if (orgIds.length > 0) {
    const { error } = await svc.from("organizations").delete().in("id", orgIds);
    if (error) throw error;
  }
  if (userId) {
    const { error } = await svc.auth.admin.deleteUser(userId);
    if (error) throw error;
  }
});

async function entrar(page: PlaywrightTestTypes.Page) {
  await loginComoMembro(page, EMAIL, SENHA, "/app/agenda");
}

/** Os nomes dos chips de tipo, como quem olha a tela os leria. */
async function tiposOferecidos(page: PlaywrightTestTypes.Page): Promise<string[]> {
  await page.goto("/app/agenda");
  await page.getByRole("button", { name: /Novo agendamento/i }).click();
  const painel = page.getByRole("dialog", { name: /Novo agendamento/i });
  await expect(painel, "o painel de marcação não abriu").toBeVisible({ timeout: 20_000 });
  const lista = painel.getByTestId("tipos-de-agendamento");
  let nomes: string[];
  if ((await lista.count()) > 0) {
    const textos = await lista.getByRole("button").allInnerTexts();
    // O chip é "Nome" + a duração colada ("Consulta E2E 30min"). O nome é a
    // primeira linha; o `replace` tira o sufixo quando não há quebra.
    nomes = textos.map((t) =>
      t
        .split("\n")[0]!
        .replace(/\d+\s*min$/i, "")
        .trim(),
    );
  } else {
    // Com UM tipo não existe escolha a fazer, por isso o seletor some. O tipo
    // oferecido continua visível no contexto da marcação e é dali que um
    // usuário confirma o que está prestes a marcar.
    const contexto = painel.getByTestId("contexto-da-marcacao");
    await expect(contexto, "o único tipo não apareceu no contexto").toBeVisible();
    nomes = [(await contexto.locator("h3").innerText()).trim()];
  }
  // FECHA O PAINEL antes de devolver. Ele é um `Sheet` com overlay
  // `fixed inset-0`, e deixá-lo aberto faz o próximo clique — o do seletor de
  // organização — bater no overlay em vez de no botão. Medido: a spec falhava
  // com "intercepts pointer events" por 150s, num ponto que não tinha nada a ver
  // com o que ela mede.
  await page.keyboard.press("Escape");
  await expect(painel).toBeHidden({ timeout: 10_000 });
  return nomes;
}

async function trocarPara(page: PlaywrightTestTypes.Page, orgId: string, nome: string) {
  const seletor = page.getByTestId("tenant-switcher");
  await expect(seletor).toBeVisible();

  // Sem cookie, o servidor elege a primeira organização como ativa. A tela é a
  // fonte confiável desse estado: clicar na organização já ativa é um no-op e,
  // portanto, nunca produziria a navegação que o teste antigo esperava.
  if ((await seletor.getByText(nome, { exact: true }).count()) > 0) return;

  await seletor.click();
  await page.getByTestId(`tenant-switcher-item-${orgId}`).click({ noWaitAfter: true });
  await expect
    .poll(
      async () =>
        (await page.context().cookies()).find((cookie) => cookie.name === "active_org")?.value,
      { message: `o cookie não confirmou a troca para ${orgId}` },
    )
    .toBe(orgId);
  // A troca substitui o documento inteiro. A sessão reconhecida pelo servidor
  // e o seletor reidratado provam o novo documento sem depender do evento
  // frágil de `load` da página anterior.
  await aguardarSessaoCompleta(page, "aal1");
  await expect(seletor, `a troca para "${nome}" não terminou`).toBeEnabled({ timeout: 60_000 });
  await expect(seletor, `a troca para "${nome}" não pegou`).toContainText(nome, {
    timeout: 20_000,
  });
}

test("membro de duas organizações vê na Agenda só os tipos da organização ativa", async ({
  page,
}) => {
  if (!duasOrgs) throw new Error("fixture isolado de duas organizações não foi criado");
  const d = duasOrgs;
  await entrar(page);

  // Começa pela org A EXPLICITAMENTE: sem isto a spec dependeria de qual org o
  // cookie ou a ordem da lista elegeu, e passaria a medir outra coisa no dia em
  // que essa ordem mudasse.
  await trocarPara(page, d.org_a_id, d.org_a_nome);
  const naOrgA = await tiposOferecidos(page);
  expect(naOrgA, `a Agenda da org A não ofereceu "${d.tipo_a.nome}"`).toContain(d.tipo_a.nome);
  expect(
    naOrgA,
    `a Agenda da org A ofereceu "${d.tipo_b.nome}", que é da OUTRA organização — ` +
      "é exatamente o defeito da v1.7.0: a consulta confiava na RLS, que é piso e não escopo.",
  ).not.toContain(d.tipo_b.nome);

  await trocarPara(page, d.org_b_id, d.org_b_nome);
  const naOrgB = await tiposOferecidos(page);
  expect(naOrgB, `troquei para a org B e "${d.tipo_b.nome}" não apareceu`).toContain(d.tipo_b.nome);
  expect(
    naOrgB,
    `a Agenda da org B ofereceu "${d.tipo_a.nome}", que ficou para trás na troca`,
  ).not.toContain(d.tipo_a.nome);

  await page.screenshot({ path: "evidence/calendario/d4-agenda-escopo-org-b.png", fullPage: true });
});
