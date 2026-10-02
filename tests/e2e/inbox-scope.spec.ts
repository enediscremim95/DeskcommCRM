/**
 * G4-02 — Inbox com escopo (acceptance 1, 3, 4). Smoke com 2 papéis reais do seed:
 *  - agent (org em modo default own_and_unassigned): NÃO vê a visão 'Todas';
 *  - manager: vê 'Todas' (org-wide read).
 * + deep-link para conversa fora do escopo → estado vazio claro, sem stack trace.
 *
 * Pré-requisito: `.e2e-creds.json` (o rbac-roles.spec já roda o seed; aqui só lê).
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { test, expect, type Page } from "@playwright/test";

import { loginComoMembro } from "./helpers/aguardar-sessao";
import { semearConversaDoInbox, type ConversaDoInbox } from "./helpers/conversa-do-inbox";

interface E2ECreds {
  password: string;
  org_id: string;
  users: Record<string, { id: string; email: string; role: string }>;
}

const CREDS_PATH = path.join(process.cwd(), ".e2e-creds.json");
const creds = JSON.parse(fs.readFileSync(CREDS_PATH, "utf8")) as E2ECreds;
const EVIDENCE = path.join(process.cwd(), "loop/checkpoints/evidence/G4");
let conversa: ConversaDoInbox;

async function login(page: Page, email: string, destino: string): Promise<void> {
  await loginComoMembro(page, email, creds.password, destino);
}

test.describe("G4-02 — inbox com escopo", () => {
  test.beforeAll(async () => {
    conversa = await semearConversaDoInbox(creds.org_id);
  });

  test.afterAll(async () => {
    await conversa.limpar();
  });

  test("agent em modo own*: vê Minhas e Fila, NÃO vê Todas", async ({ page }) => {
    await login(
      page,
      creds.users.agent!.email,
      `/app/inbox?conversation=${conversa.conversationId}`,
    );
    await expect(page.getByRole("tab", { name: /Minhas/ })).toBeVisible();
    await expect(page.getByRole("tab", { name: /Fila/ })).toBeVisible();
    await expect(page.getByRole("tab", { name: /Todas/ })).toHaveCount(0);
    await page.screenshot({ path: path.join(EVIDENCE, "G4-02-inbox-scope-agent.png"), fullPage: true });
  });

  test("manager: vê a visão Todas", async ({ page }) => {
    await login(
      page,
      creds.users.manager!.email,
      `/app/inbox?conversation=${conversa.conversationId}`,
    );
    await expect(page.getByRole("tab", { name: /Todas/ })).toBeVisible();
    await page.screenshot({ path: path.join(EVIDENCE, "G4-02-inbox-scope-manager.png"), fullPage: true });
  });

  test("deep-link para conversa fora do escopo → estado vazio claro (sem stack trace)", async ({
    page,
  }) => {
    await login(page, creds.users.agent!.email, "/app/kanban?lista=1");
    // Aquece a rota API autenticada (compile a frio em dev pode passar de 5s).
    await page.request.get("/api/v1/conversations/00000000-0000-4000-8000-0000000000ff");
    // UUID inexistente → RLS/404 → estado vazio claro (GAP D).
    await page.goto("/app/inbox/00000000-0000-4000-8000-0000000000ff");
    await expect(page.getByText(/fora do seu acesso/i)).toBeVisible({ timeout: 15_000 });
  });
});
