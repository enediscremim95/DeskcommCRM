import * as fs from "node:fs";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  env: {
    EMAIL_PROVIDER: "e2e",
    NEXT_PUBLIC_APP_URL: "http://localhost:3001",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  },
}));

vi.mock("@/lib/env", () => ({ env: h.env }));

import { E2E_EMAIL_OUTBOX, e2eOutboxAdapter } from "./e2e-outbox";
import { isEmailConfigured, sendEmail } from "../resend";

describe("caixa de saída local do E2E", () => {
  beforeEach(() => {
    h.env.EMAIL_PROVIDER = "e2e";
    h.env.NEXT_PUBLIC_APP_URL = "http://localhost:3001";
    h.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
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
  });
});
