/**
 * G3-03 — filtro por responsável no board (deep-linkável via query param).
 *
 * Verifica: os dois leads seed aparecem (um com responsável, um "Sem
 * responsável"); ao filtrar por "Sem responsável" a URL ganha ?owner=unassigned
 * e o card com dono some. Login como manager (sem MFA; vê todos os leads da org).
 *
 * Pré-requisito: seed de credenciais + seed de kanban (rodados aqui se faltarem).
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import { test, expect, type Page } from "@playwright/test";

import { loginComoMembro } from "./helpers/aguardar-sessao";

const CREDS_PATH = path.join(process.cwd(), ".e2e-creds.json");

interface Creds {
  password: string;
  users: Record<string, { email: string }>;
  kanban?: { pipeline_id: string };
}

function loadCreds(): Creds {
  const needsBase = (): boolean => {
    if (!fs.existsSync(CREDS_PATH)) return true;
    const c = JSON.parse(fs.readFileSync(CREDS_PATH, "utf8")) as Creds;
    return !c.users?.manager;
  };
  if (needsBase()) {
    execFileSync("npx", ["tsx", "scripts/seed-e2e-credentials.ts"], { stdio: "inherit" });
  }
  let c = JSON.parse(fs.readFileSync(CREDS_PATH, "utf8")) as Creds;
  if (!c.kanban?.pipeline_id) {
    execFileSync("npx", ["tsx", "scripts/seed-e2e-kanban.ts"], { stdio: "inherit" });
    c = JSON.parse(fs.readFileSync(CREDS_PATH, "utf8")) as Creds;
  }
  return c;
}

const creds = loadCreds();

async function login(page: Page, email: string): Promise<void> {
  await loginComoMembro(
    page,
    email,
    creds.password,
    `/app/pipelines/${creds.kanban!.pipeline_id}`,
  );
}

test("filtro por responsável reflete na URL e esconde leads com dono", async ({ page }) => {
  await login(page, creds.users.manager!.email);

  const owned = page.getByRole("heading", { name: "Pedido E2E com responsavel" });
  const unowned = page.getByRole("heading", { name: "Pedido E2E sem responsavel" });
  await expect(owned).toBeVisible();
  await expect(unowned).toBeVisible();
  // No card compacto, a ausência de dono é um disco tracejado com rótulo
  // acessível. Escopar ao card sem dono evita escolher por acaso um dos vários
  // discos iguais que podem existir no quadro.
  const unownedCard = page.getByRole("group", { name: "Lead: Pedido E2E sem responsavel" });
  await expect(unownedCard.getByLabel("Sem responsável")).toBeVisible();

  // O filtro reúne humanos e agentes sob o conceito de negociação.
  await page.getByRole("button", { name: /^Negociações:/ }).click();
  await page.getByRole("menuitem", { name: "Sem responsável" }).click();

  await expect(page).toHaveURL(/owner=unassigned/);
  await expect(unowned).toBeVisible();
  await expect(owned).toHaveCount(0);
});
