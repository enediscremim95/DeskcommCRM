import * as fs from "node:fs";
import * as path from "node:path";

import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

import { credenciaisSupabaseDeTeste } from "../../scripts/lib/env-de-teste";
import { semearConversaDoInbox } from "./helpers/conversa-do-inbox";

interface Credenciais {
  password: string;
  org_id: string;
  users: Record<string, { id: string; email: string }>;
}

const creds = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), ".e2e-creds.json"), "utf8"),
) as Credenciais;
const supabase = credenciaisSupabaseDeTeste();
const admin = createClient(supabase.url, supabase.serviceRole, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const evidence = path.join(process.cwd(), ".superpowers/evidence");

async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.locator("#email").fill(creds.users.manager!.email);
  await page.locator("#password").fill(creds.password);
  await page.getByRole("button", { name: /entrar/i }).click();
  await page.waitForURL(/\/app\//);
}

test("cadastra produto com imagem e o encontra no seletor da conversa", async ({ page }) => {
  const codigo = `MIDIA-${Date.now()}`;
  const nome = `Caneca visual ${codigo}`;
  const organizationId = creds.org_id;
  const conversa = await semearConversaDoInbox(organizationId);
  let productId: string | null = null;
  let productImagePath: string | null = null;

  try {
    await login(page);
    await page.goto("/app/products");
    await page.getByTestId("novo-produto").click();
    await page.getByTestId("produto-codigo").fill(codigo);
    await page.getByTestId("produto-nome").fill(nome);
    await page.getByTestId("produto-descricao").fill("Produto sintético para prova visual.");
    await page.getByTestId("produto-preco").fill("39,90");
    await page.getByTestId("produto-imagem").setInputFiles({
      name: "produto.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64",
      ),
    });
    await page.getByTestId("salvar-produto").click();
    await expect(page.getByText(nome)).toBeVisible();
    await expect(page.getByTestId(`produto-${codigo}`).locator("img")).toBeVisible();
    await page.getByTestId(`editar-${codigo}`).click();
    await page.getByTestId("produto-descricao").fill("Descrição sintética atualizada.");
    await page.getByTestId("salvar-produto").click();
    await expect(page.getByText("Descrição sintética atualizada.")).toBeVisible();

    const { data: produto } = await admin
      .from("catalog_products")
      .select("id, imagem_url")
      .eq("organization_id", organizationId)
      .eq("codigo", codigo)
      .single();
    const produtoCriado = produto as { id: string; imagem_url: string | null } | null;
    productId = produtoCriado?.id ?? null;
    const marcador = "/storage/v1/object/public/catalog-media/";
    const indice = produtoCriado?.imagem_url?.indexOf(marcador) ?? -1;
    productImagePath =
      indice >= 0
        ? decodeURIComponent(produtoCriado!.imagem_url!.slice(indice + marcador.length))
        : null;

    await page.goto("/app/inbox?filter=all");
    await page.getByText(conversa.contactName).click();
    await page.getByRole("button", { name: "Anexar" }).click();
    await page.getByRole("button", { name: "Catálogo" }).click();
    await expect(page.getByRole("heading", { name: "Enviar produtos do catálogo" })).toBeVisible();
    await expect(page.getByRole("button", { name: new RegExp(nome) })).toBeVisible();
    await page.getByRole("button", { name: new RegExp(nome) }).click();
    await expect(page.getByRole("button", { name: /Enviar 1 produto/ })).toBeEnabled();
    await page.screenshot({
      path: path.join(evidence, "catalogo-na-conversa.png"),
      fullPage: false,
    });
  } finally {
    if (productImagePath) await admin.storage.from("catalog-media").remove([productImagePath]);
    if (productId) await admin.from("catalog_products").delete().eq("id", productId);
    await conversa.limpar();
  }
});
