import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const logError = vi.hoisted(() => vi.fn());

vi.mock("@/lib/logger", () => ({
  logger: { error: logError },
}));

const CHAVES = [
  "EMAIL_PROVIDER",
  "RESEND_API_KEY",
  "RESEND_FROM_EMAIL",
  "AWS_SES_REGION",
  "AWS_SES_ACCESS_KEY_ID",
  "AWS_SES_SECRET_ACCESS_KEY",
  "SES_FROM_EMAIL",
] as const;

const originais = Object.fromEntries(CHAVES.map((key) => [key, process.env[key]]));

function configurarSes() {
  process.env.EMAIL_PROVIDER = "ses";
  process.env.AWS_SES_REGION = "us-east-1";
  process.env.AWS_SES_ACCESS_KEY_ID = "AKIAEXEMPLOTESTE";
  process.env.AWS_SES_SECRET_ACCESS_KEY = "segredo-apenas-de-teste";
  process.env.SES_FROM_EMAIL = "nao-responda@exemplo.com.br";
}

describe("provedores de e-mail", () => {
  beforeEach(() => {
    logError.mockReset();
    vi.resetModules();
  });

  afterEach(() => {
    for (const key of CHAVES) {
      const value = originais[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    vi.doUnmock("resend");
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("usa Resend por padrão quando EMAIL_PROVIDER não existe", async () => {
    delete process.env.EMAIL_PROVIDER;
    process.env.RESEND_API_KEY = "re_chave_valida_de_teste";
    process.env.RESEND_FROM_EMAIL = "nao-responda@exemplo.com.br";
    const resendSend = vi.fn().mockResolvedValue({ data: { id: "resend-1" }, error: null });
    vi.doMock("resend", () => ({
      Resend: class {
        emails = { send: resendSend };
      },
    }));
    const awsFetch = vi.fn();
    vi.stubGlobal("fetch", awsFetch);
    const { sendEmail } = await import("@/lib/email/resend");

    expect(
      await sendEmail({
        to: "destino@exemplo.com",
        subject: "Teste",
        html: "<p>ok</p>",
        fromName: "Clínica Teste",
      }),
    ).toEqual({ ok: true, id: "resend-1" });
    expect(resendSend).toHaveBeenCalledOnce();
    expect(awsFetch).not.toHaveBeenCalled();
  });

  it("seleciona SES, assina a requisição e devolve sucesso sem chamar a AWS real", async () => {
    configurarSes();
    const awsFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ MessageId: "ses-1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", awsFetch);
    const { fromAddress, isEmailConfigured, sendEmail } = await import("@/lib/email/resend");

    expect(isEmailConfigured()).toBe(true);
    expect(fromAddress("Clínica Teste")).toBe("Clínica Teste <nao-responda@exemplo.com.br>");
    expect(
      await sendEmail({
        to: "destino@exemplo.com",
        subject: "Teste",
        html: "<p>ok</p>",
        fromName: "Clínica Teste",
      }),
    ).toEqual({ ok: true, id: "ses-1" });

    expect(awsFetch).toHaveBeenCalledOnce();
    const [url, init] = awsFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://email.us-east-1.amazonaws.com/v2/email/outbound-emails");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      "content-type": "application/json",
      authorization: expect.stringContaining("AWS4-HMAC-SHA256 Credential=AKIAEXEMPLOTESTE/"),
    });
    expect(JSON.parse(String(init.body))).toMatchObject({
      FromEmailAddress: "=?UTF-8?B?Q2zDrW5pY2EgVGVzdGU=?= <nao-responda@exemplo.com.br>",
      Destination: { ToAddresses: ["destino@exemplo.com"] },
    });
  });

  it("mantém o SendResult na falha do SES e registra provedor e motivo", async () => {
    configurarSes();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            __type: "TooManyRequestsException",
            message: "Daily quota exceeded",
          }),
          { status: 429 },
        ),
      ),
    );
    const { sendEmail } = await import("@/lib/email/resend");

    expect(await sendEmail({ to: "destino@exemplo.com", subject: "Teste", html: "x" })).toEqual({
      ok: false,
      error: "rate_limited",
      details: "Daily quota exceeded",
    });
    expect(logError).toHaveBeenCalledWith(
      "Falha no envio de e-mail",
      expect.objectContaining({ provider: "ses", motivo: "rate_limited" }),
    );
  });

  it("SES sem credenciais fica não configurado e não tenta rede", async () => {
    process.env.EMAIL_PROVIDER = "ses";
    process.env.AWS_SES_REGION = "";
    process.env.AWS_SES_ACCESS_KEY_ID = "";
    process.env.AWS_SES_SECRET_ACCESS_KEY = "";
    process.env.SES_FROM_EMAIL = "nao-responda@exemplo.com.br";
    const awsFetch = vi.fn();
    vi.stubGlobal("fetch", awsFetch);
    const { isEmailConfigured, sendEmail } = await import("@/lib/email/resend");

    expect(isEmailConfigured()).toBe(false);
    expect(await sendEmail({ to: "destino@exemplo.com", subject: "Teste", html: "x" })).toEqual({
      ok: false,
      error: "not_configured",
    });
    expect(awsFetch).not.toHaveBeenCalled();
  });
});
