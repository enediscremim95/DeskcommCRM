import * as fs from "node:fs";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  env: {
    EMAIL_PROVIDER: "e2e",
    NEXT_PUBLIC_APP_URL: "http://localhost:3001",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    E2E_EMAIL_FAIL_TO_PREFIX: "e2e-falha-",
  },
}));

vi.mock("@/lib/env", () => ({ env: h.env }));

import {
  E2E_EMAIL_OUTBOX,
  e2eOutboxAdapter,
  findE2EOutboxEmail,
} from "./e2e-outbox";
import { isEmailConfigured, sendEmail } from "../resend";

describe("caixa de saída local do E2E", () => {
  beforeEach(() => {
    h.env.EMAIL_PROVIDER = "e2e";
    h.env.NEXT_PUBLIC_APP_URL = "http://localhost:3001";
    h.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
    h.env.E2E_EMAIL_FAIL_TO_PREFIX = "e2e-falha-";
    fs.rmSync(path.join(process.cwd(), E2E_EMAIL_OUTBOX), { force: true });
  });
  afterEach(() => fs.rmSync(path.join(process.cwd(), E2E_EMAIL_OUTBOX), { force: true }));

  it("recusa uso fora do app e banco locais", () => {
    h.env.NEXT_PUBLIC_APP_URL = "https://crm.example.com";
    expect(e2eOutboxAdapter.isConfigured()).toBe(false);

    h.env.NEXT_PUBLIC_APP_URL = "http://localhost:3001";
    h.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    expect(e2eOutboxAdapter.isConfigured()).toBe(false);
  });

  it("registra a mensagem completa para a spec provar a entrega", async () => {
    expect(isEmailConfigured()).toBe(true);
    expect(isEmailConfigured({ includeTestTransport: false })).toBe(false);
    const result = await sendEmail({
      to: "convidado@example.test",
      subject: "Convite",
      html: "<p>aceite</p>",
      text: "aceite",
      fromName: "Produto",
    });

    expect(result).toMatchObject({ ok: true, id: expect.stringMatching(/^e2e-/) });
    const outbox = fs.readFileSync(path.join(process.cwd(), E2E_EMAIL_OUTBOX), "utf8");
    expect(outbox).toContain('"to":"convidado@example.test"');
    expect(outbox).toContain('"html":"<p>aceite</p>"');
    await expect(findE2EOutboxEmail("convidado@example.test", "Convi")).resolves.toBe(
      "<p>aceite</p>",
    );
    await expect(findE2EOutboxEmail("outra-pessoa@example.test", "Convite")).resolves.toBeNull();
  });

  it("simula falha apenas para o destinatário que o teste marcou", async () => {
    const result = await sendEmail({
      to: "e2e-falha-caso-unico@example.test",
      subject: "Acesso",
      html: "<p>credenciais</p>",
    });

    expect(result).toEqual({ ok: false, error: "send_failed" });
    expect(fs.existsSync(path.join(process.cwd(), E2E_EMAIL_OUTBOX))).toBe(false);
  });
});
