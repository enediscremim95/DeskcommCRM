/**
 * Radar de Risco (C1 — desilhamento da doutrina do sistema vivo). Prova, na
 * perspectiva do usuário real: (1) o atendente entra no Radar e VÊ somente o
 * alerta da demanda aberta sem próximo passo; (2) ele abre o formulário para
 * marcar o follow-up sem sair da tela. Login como manager (sem MFA).
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import { test, expect, type Page } from "@playwright/test";

const CREDS_PATH = path.join(process.cwd(), ".e2e-creds.json");

interface Creds {
  password: string;
  users: Record<string, { email: string }>;
  radar?: { at_risk_title: string };
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
  // Sempre reseta o fixture do radar (conversa volta a ficar sem dono).
  execFileSync("npx", ["tsx", "scripts/seed-e2e-radar.ts"], { stdio: "inherit" });
  return JSON.parse(fs.readFileSync(CREDS_PATH, "utf8")) as Creds;
}

const creds = loadCreds();

async function login(page: Page, email: string): Promise<void> {
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(creds.password);
  await page.getByRole("button", { name: /entrar/i }).click();
  await page.waitForURL(/\/app\//);
}

async function gotoRadar(page: Page): Promise<void> {
  await page.getByRole("link", { name: "Radar" }).click();
  await page.waitForURL(/\/app\/radar/);
  await expect(page.getByRole("heading", { name: "Radar de risco" })).toBeVisible();
}

function radarItem(page: Page) {
  return page.locator('[data-testid="radar-item"]', { hasText: creds.radar!.at_risk_title });
}

test("o atendente vê no Radar a demanda aberta que esfriou sem próximo passo", async ({ page }) => {
  await login(page, creds.users.manager!.email);
  await gotoRadar(page);

  const item = radarItem(page);
  await expect(item).toBeVisible();
  await expect(item).toHaveAttribute("data-risk", "critico");
  await expect(item.getByText("Lead sem próximo passo")).toBeVisible();
  await expect(page.getByTestId("radar-counts")).toHaveCount(0);
});

test("o atendente marca o próximo follow-up sem sair do Radar", async ({ page }) => {
  await login(page, creds.users.manager!.email);
  await gotoRadar(page);

  const item = radarItem(page);
  await expect(item).toBeVisible();
  await item.getByRole("button", { name: "Marcar follow-up" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Marcar follow-up" })).toBeVisible();
  await expect(page).toHaveURL(/\/app\/radar/);
});
