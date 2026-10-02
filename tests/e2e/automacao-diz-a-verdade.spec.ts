/**
 * E2E — A AUTOMAÇÃO NÃO CARIMBA "SUCESSO" NUMA MENSAGEM QUE NÃO SAIU.
 *
 * Este arquivo existe por causa de um relato de uso real: uma automação
 * ligada ("quando entrar contato novo pelo webhook → enviar mensagem no
 * WhatsApp"), um lead entrando pelo formulário, e nenhuma mensagem chegando ao
 * cliente. Reproduzido: a aba Atividade mostrava **Sucesso**, com ✓ verde,
 * enquanto a linha em `messages` estava `failed` com `error_code='waha_error'`.
 *
 * A causa é que `sendMessageHandler` NÃO lança quando o envio falha — ele marca
 * a mensagem e a devolve normalmente, porque quem o chama pela tela é o Inbox,
 * que renderiza a bolha com o estado dela. A ação da automação só olhava se
 * houve exceção.
 *
 * ═══ Por que este cenário é o natural no rig, e não uma armação ═══
 *
 * O `.env.e2e` aponta `WAHA_API_BASE_URL` para `127.0.0.1:3999`, onde não há
 * ninguém. Ou seja: o rig JÁ é uma instalação com o WhatsApp fora do ar, que é
 * exatamente a situação do relato. Não é preciso sabotar nada — basta olhar o
 * que a tela diz.
 *
 * O que a tela tem que dizer agora: **Falhou**, com a frase que explica e diz o
 * que conferir.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";

import { test, expect, type Page, type Locator, type APIRequestContext } from "@playwright/test";
import { carregarEnvLocal } from "../../scripts/lib/env-de-teste";
import { aguardarSessaoCompleta } from "./helpers/aguardar-sessao";

const APP_URL = `http://localhost:${process.env.E2E_PORT ?? "3001"}`;
const CREDS_PATH = path.join(process.cwd(), ".e2e-creds.json");

interface Creds {
  password: string;
  users: Record<string, { email: string }>;
}

interface ExecucaoDaRegra {
  status: "success" | "failed" | "partial" | "adiado";
  actions_result: Array<{
    status: "success" | "failed" | "skipped" | "postponed";
    detail?: Record<string, unknown>;
  }>;
  automation_rules: { name: string } | null;
}

function loadCreds(): Creds {
  if (!fs.existsSync(CREDS_PATH)) {
    execFileSync("npx", ["tsx", "scripts/seed-e2e-credentials.ts"], { stdio: "inherit" });
  }
  // Um número CONECTADO é pré-condição: a tela desabilita todo número que não
  // esteja `WORKING`, e o seed base não cria nenhum. Conectar de verdade exige
  // ler QR no celular, o que não existe num rig — ver o cabeçalho do seed.
  execFileSync("npx", ["tsx", "scripts/seed-e2e-numero-conectado.ts"], { stdio: "inherit" });
  return JSON.parse(fs.readFileSync(CREDS_PATH, "utf8")) as Creds;
}

function internalSecret(): string {
  const s = carregarEnvLocal().INTERNAL_SECRET?.trim();
  if (!s) throw new Error("INTERNAL_SECRET não encontrado no ambiente de teste");
  return s;
}

const creds = loadCreds();
const ts = Date.now();
const SOURCE_NAME = `E2E Verdade ${ts}`;
const RULE_NAME = `E2E Abordar ${ts}`;
const LEAD_NAME = `Carlos Verdade ${ts}`;

/**
 * Sobe do texto até o CARD do design system (o container com `border-border`).
 *
 * Mesmo helper de `webhooks.spec.ts`, e a razão de ele existir foi medida aqui:
 * `locator("div").filter({ has: texto }).last()` devolve o div mais INTERNO que
 * contém o título — que não contém o badge de status, irmão dele na árvore. A
 * asserção reprovava com a tela certa na frente.
 */
function cardDe(locator: Locator): Locator {
  return locator.locator(
    "xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' border-border ')][1]",
  );
}

async function login(page: Page, email: string): Promise<void> {
  await page.goto(`${APP_URL}/login?next=/app/settings/profile`);
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(creds.password);
  await page.getByRole("button", { name: /entrar/i }).click();
  await aguardarSessaoCompleta(page, "aal1");
}

async function drenar(request: APIRequestContext, page: Page): Promise<void> {
  for (let i = 0; i < 3; i++) {
    const r = await request.post(`${APP_URL}/api/v1/cron/event-log-drain`, {
      headers: { Authorization: `Bearer ${internalSecret()}` },
      timeout: 60_000,
    });
    expect(r.ok()).toBeTruthy();
    await page.waitForTimeout(700);
  }
}

test.describe("a automação conta o que aconteceu de verdade", () => {
  test.setTimeout(180_000);
  test.use({ actionTimeout: 15_000 });

  // O seed roda de novo AQUI, e não só na carga do módulo.
  //
  // `loadCreds()` executa quando o Playwright COLETA o arquivo, o que pode ser
  // bem antes deste teste rodar — e o banco do CI é compartilhado entre as duas
  // partes do job, sem reset. Uma spec que rode no meio pode deixar a sessão
  // fora de `WORKING` (o watchdog de canal reconcilia status), e aí o número
  // que este teste precisa aparece desabilitado na tela.
  //
  // Reexecutar é barato: o seed é idempotente pelo `waha_session_name` e
  // reafirma `status='WORKING'` quando a linha já existe.
  test.beforeAll(() => {
    execFileSync("npx", ["tsx", "scripts/seed-e2e-numero-conectado.ts"], { stdio: "inherit" });
  });

  test("envio que morre aparece como FALHOU, com a razão — nunca como sucesso", async ({
    page,
    request,
  }) => {
    let sourceId: string | undefined;
    let ruleId: string | undefined;

    try {
      await login(page, creds.users.manager!.email);
      await page.goto(`${APP_URL}/app/webhooks`);

      // ── A fonte ──────────────────────────────────────────────────────────
      await page.getByRole("button", { name: /Conectar primeira página|Conectar página/ }).click();
      await page.locator("#src-name").fill(SOURCE_NAME);
      await page.getByRole("button", { name: "Continuar" }).click();
      const dialog = page.getByRole("dialog");
      for (const i of [0, 1, 2]) {
        await dialog.getByRole("combobox").nth(i).click();
        await page.getByRole("option").first().click();
      }
      const [criacao] = await Promise.all([
        page.waitForResponse(
          (r) => r.url().includes("/api/v1/webhook-sources") && r.request().method() === "POST",
        ),
        page.getByRole("button", { name: "Criar fonte e gerar script" }).click(),
      ]);
      const fonte = (await criacao.json()) as { data: { id: string; path_token: string } };
      sourceId = fonte.data.id;
      await page.keyboard.press("Escape");

      // ── A automação, montada pela TELA, igual à do relato ────────────────
      await page.getByRole("tab", { name: "Automações" }).click();
      await page.getByRole("button", { name: /Nova automação/ }).click();
      await page.locator("#rule-name").fill(RULE_NAME);

      const editor = page.getByRole("dialog");
      // QUANDO: contato novo por webhook
      await editor.getByRole("combobox").first().click();
      await page.getByRole("option", { name: /contato novo \(webhook\)/i }).click();

      // ENTÃO: enviar mensagem no WhatsApp
      await editor.getByRole("combobox").filter({ hasText: "Adicionar ação" }).click();
      await page.getByRole("option", { name: "Enviar mensagem no WhatsApp" }).click();

      // O número: o seed garante uma sessão WORKING; se não houvesse, o teste
      // não teria o que provar — daí a espera EXPLÍCITA antes de contar.
      //
      // `count()` não tem auto-wait: perguntado logo depois do clique, ele
      // responde 0 porque o dropdown do Radix ainda não montou, e o teste
      // reprova dizendo "nenhum número no seed" com o número lá. Instrumento
      // cego acusando o alvo errado — o `expect(...).toBeVisible()` é que
      // espera de verdade.
      const seletorDeNumero = editor.getByRole("combobox").filter({ hasText: /Escolha o número/ });
      await seletorDeNumero.click();

      // O número DESTE cenário, não o primeiro da lista.
      //
      // A tela desabilita quem não está `WORKING` (correto — mandar por número
      // desconectado é o defeito que aquele `disabled` evita), e o banco do CI é
      // compartilhado entre as duas partes do job: outras specs deixam sessões
      // em `STARTING`/`FAILED`, e a ordem não é garantida. `.first()` pegava uma
      // dessas e o clique expirava em `aria-disabled="true"` — medido no CI.
      //
      // Escolher qualquer WORKING deixava a asserção depender dos knobs de uma
      // sessão criada por outra spec. O seed abre e autoriza este número pelo
      // nome idempotente, portanto é ele que torna a entrada determinística.
      const numeroDoCenario = page.getByRole("option", {
        name: /Número conectado \(E2E\)/,
      });
      await expect(
        numeroDoCenario,
        "o número de WhatsApp do cenário não está WORKING — rode scripts/seed-e2e-numero-conectado.ts",
      ).toBeVisible({ timeout: 10_000 });
      await numeroDoCenario.click();

      await editor.getByRole("textbox").last().fill(`Olá {{nome}}, vi que você se cadastrou.`);

      const [salvo] = await Promise.all([
        page.waitForResponse(
          (r) => r.url().includes("/api/v1/automation-rules") && r.request().method() === "POST",
        ),
        page.getByRole("button", { name: "Criar automação" }).click(),
      ]);
      expect(salvo.ok()).toBeTruthy();
      ruleId = ((await salvo.json()) as { data: { id: string } }).data.id;

      // Liga a regra (nasce pausada, por desenho).
      await page.getByLabel(new RegExp(`Ligar ${RULE_NAME}`)).click();
      await expect(page.getByText("Automação ligada.")).toBeVisible({ timeout: 15_000 });

      // ── O lead entra pelo formulário ─────────────────────────────────────
      const envio = await request.post(`${APP_URL}/api/v1/webhooks/in/${fonte.data.path_token}`, {
        data: { nome: LEAD_NAME, telefone: "11933332222" },
      });
      expect(envio.status()).toBe(200);

      // ── PRIMEIRO o backend, DEPOIS a tela ────────────────────────────────
      //
      // Drena até a execução chegar ao DESFECHO, medindo pela rota que a aba
      // consome. Existir não basta: o ritmo humano persiste a mesma execução
      // como `adiado` durante as esperas duráveis anteriores ao envio. Parar
      // no primeiro run confundia esse estado intermediário legítimo com uma
      // janela fechada e nunca deixava o WhatsApp fora do ar ser tentado.
      //
      // Separar as perguntas mantém as asserções e tira o ruído: se a regra
      // não rodar, o laço nomeia isso; se a janela fechar, o motivo técnico
      // denuncia o seed; se a tela não mostrar o desfecho, a asserção abaixo
      // acusa a camada visual.
      let execucao: ExecucaoDaRegra | undefined;
      for (let tentativa = 0; tentativa < 12 && execucao?.status !== "failed"; tentativa++) {
        await drenar(request, page);
        const resposta = await page.request.get(`${APP_URL}/api/v1/automation-rules/runs?limit=50`);
        expect(resposta.ok()).toBeTruthy();
        const corpo = (await resposta.json()) as {
          data: ExecucaoDaRegra[];
        };
        execucao = corpo.data.find((r) => r.automation_rules?.name === RULE_NAME);
        if (!execucao || execucao.status !== "adiado") continue;

        const motivos = execucao.actions_result
          .map((acao) => acao.detail?.reason)
          .filter((motivo): motivo is string => typeof motivo === "string");

        // Desde que o produto ganhou ritmo humano durável, "adiado" também é
        // o estado correto durante os 40–100s antes da primeira mensagem e o
        // intervalo de "digitando". A versão anterior parava ao encontrar
        // QUALQUER run e chamava todo adiamento de "janela fechada" — portanto
        // media um estado intermediário como se fosse o desfecho.
        expect(
          motivos,
          "a execução foi adiada pela janela de envio — o seed 0h-24h não alcançou o canal da regra",
        ).not.toContain("fora_da_janela_de_envio");
        expect(
          motivos.some((motivo) => motivo.startsWith("ritmo_humano_")),
          `adiamento intermediário sem causa de ritmo humano: ${motivos.join(", ") || "sem motivo"}`,
        ).toBe(true);

        const retryAt = execucao.actions_result
          .map((acao) => acao.detail?.retry_at)
          .find((valor): valor is string => typeof valor === "string");
        const esperaAteRetomada = retryAt
          ? Math.min(Math.max(Date.parse(retryAt) - Date.now() + 300, 250), 30_000)
          : 1_000;
        await page.waitForTimeout(esperaAteRetomada);
      }
      expect(
        execucao,
        "a automação não registrou execução nenhuma — a regra não rodou",
      ).toBeDefined();
      expect(
        execucao?.status,
        "a automação registrou a execução, mas não chegou ao desfecho real do envio",
      ).toBe("failed");

      // ── A TELA: o que a aba Atividade diz ────────────────────────────────
      await page.getByRole("tab", { name: "Atividade" }).click();
      const cartao = cardDe(page.getByText(RULE_NAME, { exact: true }).first());
      await expect(
        page.getByText(RULE_NAME, { exact: true }).first(),
        "a execução existe no banco mas a aba Atividade não a mostra",
      ).toBeVisible({ timeout: 20_000 });

      // ═══ A ASSERÇÃO QUE ESTE ARQUIVO EXISTE PARA FAZER ═══
      //
      // O WhatsApp está fora do ar neste ambiente, então a mensagem não saiu.
      // A tela tem que dizer isso — e NÃO pode dizer "Sucesso".
      await expect(cartao.getByText("Sucesso")).toHaveCount(0);
      // No DESFECHO também não pode continuar adiado. A espera legítima do
      // ritmo humano já terminou no laço acima; se este badge sobreviver agora,
      // o envio nunca chegou a ser tentado.
      await expect(
        cartao.getByText("Aguardando envio"),
        "o envio continuou ADIADO e não chegou ao desfecho terminal",
      ).toHaveCount(0);
      await expect(cartao.getByText("Falhou").first()).toBeVisible();

      // E tem que dizer o QUE conferir, em português — não `waha_error`.
      await expect(
        cartao.getByText(/serviço de WhatsApp|não está conectado/i).first(),
      ).toBeVisible();
    } finally {
      // ⚠️ `page.request` (com os cookies do login), NUNCA o fixture `request`.
      //
      // O fixture é um `APIRequestContext` ANÔNIMO — não há `storageState` no
      // `playwright.config.ts` —, e as duas rotas exigem `manager`. O DELETE
      // voltava 401, o `.catch` engolia, e a regra de ENVIO ficava ATIVA na
      // organização compartilhada, que nenhum passo desta suíte reseta.
      //
      // O estrago não ficava aqui. A pré-checagem de adiamento do motor é
      // all-or-nothing sobre o evento: com uma regra de envio viva no gatilho
      // "contato novo (webhook)", QUALQUER outra spec que dispare esse gatilho
      // tem o evento inteiro abortado junto — foi assim que `webhooks.spec`,
      // que só adiciona uma tag, passou a cair sem ter nada com WhatsApp.
      //
      // A própria spec já sabia da diferença: a leitura dos runs, mais acima,
      // usa `page.request.get` justamente porque precisa estar autenticada.
      if (ruleId) {
        await page.request
          .delete(`${APP_URL}/api/v1/automation-rules/${ruleId}`)
          .catch(() => undefined);
      }
      if (sourceId) {
        await page.request
          .delete(`${APP_URL}/api/v1/webhook-sources/${sourceId}`)
          .catch(() => undefined);
      }
    }
  });

  test("a ação 'Mensagem escrita pela IA' aparece no ENTÃO e pede agente, número e contexto", async ({
    page,
  }) => {
    // A configuração é o produto aqui: se a tela não deixa escrever o contexto,
    // a feature inteira vira "manda um JSON e reza".
    await login(page, creds.users.manager!.email);
    await page.goto(`${APP_URL}/app/webhooks`);
    await page.getByRole("tab", { name: "Automações" }).click();
    await page.getByRole("button", { name: /Nova automação/ }).click();

    const editor = page.getByRole("dialog");
    await editor.getByRole("combobox").first().click();
    await page.getByRole("option", { name: /contato novo \(webhook\)/i }).click();

    await editor.getByRole("combobox").filter({ hasText: "Adicionar ação" }).click();
    await page.getByRole("option", { name: "Mensagem escrita pela IA" }).click();

    // Os três campos, na ordem em que a decisão acontece.
    await expect(editor.getByText("Qual agente escreve")).toBeVisible();
    await expect(editor.getByText("Número de WhatsApp")).toBeVisible();
    await expect(editor.getByText("O que a IA deve fazer com os dados")).toBeVisible();

    // O campo de contexto é editável e aceita a instrução do dono do negócio.
    const contexto = editor.locator("#ai-instruction");
    await contexto.fill("Agradeça citando o segmento e pergunte o melhor horário.");
    await expect(contexto).toHaveValue(/Agradeça citando o segmento/);

    // E a tela diz o que o agente já sabe — para a pessoa não repetir isso na
    // instrução, que é o erro que todo mundo comete na primeira vez.
    await expect(editor.getByText(/já sabe que é a PRIMEIRA mensagem/i)).toBeVisible();

    await page.keyboard.press("Escape");
  });
});
