import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:|\/)/.test(url))
  throw new Error("Teste exige Supabase local.");
const svc = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});
const orgId = randomUUID();
const channelId = randomUUID();
const email = `proactivity-${orgId}@example.test`;
const password = "Synthetic-Proactivity-2026!";
let userId: string;
test.beforeAll(async () => {
  const { data, error } = await svc.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error("Falha no seed sintético");
  userId = data.user.id;
  const org = await svc.from("organizations").insert({
    id: orgId,
    slug: `proactivity-${orgId}`,
    legal_name: "Proatividade sintética",
    display_name: "Proatividade sintética",
  });
  if (org.error) throw org.error;
  const membership = await svc.from("user_organizations").insert({
    user_id: userId,
    organization_id: orgId,
    role: "admin",
    accepted_at: new Date().toISOString(),
  });
  if (membership.error) throw membership.error;
  const channel = await svc
    .from("channel_sessions")
    .insert({
      id: channelId,
      organization_id: orgId,
      display_name: "Canal sintético",
      waha_session_name: `lote2-${orgId}`,
      webhook_secret_encrypted: "\\x00",
    });
  if (channel.error) throw channel.error;
});
test.afterAll(async () => {
  await svc.from("organizations").delete().eq("id", orgId);
  if (userId) await svc.auth.admin.deleteUser(userId);
});
test("primeiro contato nasce desligado e permite editar textos sem ativar envios", async ({
  page,
}, testInfo) => {
  await page.goto("/login?next=/app/settings/tenant");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: /entrar/i }).click();
  await page.waitForURL(/\/app\/settings\/tenant(?:\?|$)/);
  const field = page
    .getByRole("group", { name: "Primeiro contato de formulário" })
    .filter({ visible: true });
  await expect(field.getByRole("checkbox")).not.toBeChecked();
  await expect(field.locator("#proactive-attempts")).toHaveValue("3");
  await field.locator("#proactive-channel").selectOption({ label: "Canal sintético" });
  await field
    .locator("#proactive-whatsapp")
    .fill("Olá! Recebemos seu formulário. Como podemos ajudar?");
  await field
    .locator("#proactive-email")
    .fill("Olá! Recebemos seu formulário. Você pode responder a este e-mail.");
  await page
    .getByRole("button", { name: /salvar/i })
    .filter({ visible: true })
    .click();
  await expect(page.getByText("Organização atualizada.", { exact: true })).toBeVisible();
  await page.reload();
  await expect(field.locator("#proactive-channel")).toHaveValue(channelId);
  await expect(field.getByRole("checkbox")).not.toBeChecked();
  await expect(field.locator("#proactive-whatsapp")).toHaveValue(
    "Olá! Recebemos seu formulário. Como podemos ajudar?",
  );
  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: 900 });
    await field.scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.body.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`proatividade-${width}.png`),
      fullPage: true,
    });
  }
  const { data: attempts, error } = await svc
    .from("form_proactivity_attempts")
    .select("phase")
    .eq("organization_id", orgId);
  expect(error).toBeNull();
  expect(attempts).toEqual([]);
});
