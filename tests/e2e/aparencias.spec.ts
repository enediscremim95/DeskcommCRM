import { mkdirSync } from "node:fs";
import * as path from "node:path";
import { test, expect } from "@playwright/test";
import { lerCreds, loginComoAdmin } from "./helpers/login-admin";

test("aparência acompanha navegação, reload, menus e celular", async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await loginComoAdmin(page, lerCreds());
  await page.getByRole("link", { name: "Aparência", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Aparência", exact: true })).toBeVisible();
  const evidence = path.join(process.cwd(), ".superpowers", "evidence", "aparencias");
  mkdirSync(evidence, { recursive: true });
  const themes = [
    { name: "Veritas", id: "veritas", mode: "light", bg: "rgb(247, 249, 244)" },
    { name: "Azul Asaas", id: "asaas", mode: "light", bg: "rgb(245, 248, 252)" },
    { name: "ChatGPT claro", id: "chatgpt-light", mode: "light", bg: "rgb(255, 255, 255)" },
    { name: "ChatGPT escuro", id: "chatgpt-dark", mode: "dark", bg: "rgb(33, 33, 33)" },
  ];
  for (const theme of themes) {
    await page.getByRole("radio", { name: theme.name, exact: true }).check();
    await expect(page.locator("html")).toHaveAttribute("data-appearance", theme.id);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme.mode);
    await expect(page.locator('input[name="appearance"]:checked')).toHaveCount(1);
    await page.reload();
    await expect(page.getByRole("radio", { name: theme.name, exact: true })).toBeChecked();
    await expect(page.locator("body")).toHaveCSS("background-color", theme.bg);
    await page.screenshot({ path: path.join(evidence, `${theme.id}.png`), fullPage: true });
    await page.getByRole("link", { name: "Ver nas conversas", exact: true }).click();
    await expect(page).toHaveURL(/\/app\/inbox/);
    await expect(page.locator("html")).toHaveAttribute("data-appearance", theme.id);
    await page.getByRole("link", { name: "Aparência", exact: true }).click();
  }
  // A escolha funciona também sem mouse, com a navegação nativa do radio group.
  await page.getByRole("radio", { name: "Veritas", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("radio", { name: "Azul Asaas", exact: true })).toBeChecked();
  await page.getByRole("radio", { name: "ChatGPT escuro", exact: true }).check();
  await page.getByRole("button", { name: "Menu do usuário", exact: true }).click();
  await expect(page.getByRole("menu")).toBeVisible();
  await expect(page.getByRole("menu")).toHaveCSS("background-color", "rgb(38, 38, 38)");
  await page.keyboard.press("Escape");

  for (const width of [1280, 768, 375]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole("radio", { name: "Veritas", exact: true })).toBeAttached();
    const overflow = await page.evaluate(
      () => document.body.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(overflow, "Sem rolagem horizontal na largura " + width).toBe(false);
    const overlaps = await page.locator(".crm-topbar").evaluate((header) => {
      const controls = Array.from(header.querySelectorAll("button, a"))
        .map((element) => ({
          label: element.getAttribute("aria-label") ?? element.textContent?.trim() ?? element.tagName,
          rect: element.getBoundingClientRect(),
        }))
        .filter(({ rect }) => rect.width > 0 && rect.height > 0);
      return controls.flatMap((control, index) => controls.slice(index + 1)
        .filter((other) =>
          Math.min(control.rect.right, other.rect.right) > Math.max(control.rect.left, other.rect.left) + 1 &&
          Math.min(control.rect.bottom, other.rect.bottom) > Math.max(control.rect.top, other.rect.top) + 1)
        .map((other) => `${control.label} / ${other.label}`));
    });
    expect(overlaps, "Controles do topo não se sobrepõem na largura " + width).toEqual([]);
    await page.screenshot({ path: path.join(evidence, width + ".png"), fullPage: true });
  }
  await page.getByRole("button", { name: "Abrir navegação", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("dialog").getByRole("link", { name: "Inbox", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/inbox/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(errors).toEqual([]);
});
