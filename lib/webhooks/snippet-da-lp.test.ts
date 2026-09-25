// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { gerarSnippetDaLandingPage } from "@/lib/webhooks/snippet-da-lp";

describe("gerarSnippetDaLandingPage", () => {
  const snippet = gerarSnippetDaLandingPage(
    "https://crm.example.com/api/v1/webhooks/in/token-publico",
    "Dia dos Professores",
  );

  it("aponta para a fonte e exige marca explícita no formulário", () => {
    expect(snippet).toContain(
      'const endpoint = "https://crm.example.com/api/v1/webhooks/in/token-publico"',
    );
    expect(snippet).toContain('form[data-crm-lead]');
    expect(snippet).toContain('const pagina = "Dia dos Professores"');
  });

  it("leva UTMs, confirma lead_id e mantém external_id nos retries", () => {
    expect(snippet).toContain('startsWith("utm_")');
    expect(snippet).toContain("body?.data?.lead_id");
    expect(snippet).toContain("payload.external_id = form.dataset.crmExternalId");
    expect(snippet).toContain('name = "external_id"');
  });

  it("repete falhas transitórias sem bloquear o fluxo original", () => {
    expect(snippet).toContain("tentativa < 2");
    expect(snippet).toContain("navigator.sendBeacon(endpoint, JSON.stringify(payload))");
    expect(snippet).toContain("crm:lead");
    expect(snippet).toContain("form.requestSubmit(submitter || undefined)");
    expect(snippet).toContain("emFluxoOriginal.add(form)");
  });

  it("não permite fechar a tag script a partir da URL", () => {
    const hostil = gerarSnippetDaLandingPage(
      "https://example.com/</script><script>alert(1)</script>",
      "Página </script><script>alert(2)</script>",
    );
    expect(hostil).not.toContain("https://example.com/</script>");
    expect(hostil).toContain("<\\/script>");
  });

  it("envia JSON, inclui UTMs, confirma e depois libera o submit original", async () => {
    window.history.replaceState({}, "", "/?utm_source=instagram&utm_campaign=lancamento");
    document.body.innerHTML = `<form data-crm-lead>
      <input name="nome" value="Ana" />
      <input name="telefone" value="11999990000" />
      <button type="submit">Enviar</button>
    </form>`;

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { lead_id: "lead-123" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const form = document.querySelector("form")!;
    let fluxoOriginalSeguiu = false;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      fluxoOriginalSeguiu = true;
    });

    const codigo = snippet.slice(snippet.indexOf("<script>") + 8, snippet.lastIndexOf("</script>"));
    Function(codigo)();

    const resultado = new Promise<{ ok: boolean; lead_id: string }>((resolve) => {
      form.addEventListener("crm:lead", (event) =>
        resolve((event as CustomEvent<{ ok: boolean; lead_id: string }>).detail),
      );
    });
    form.requestSubmit(form.querySelector("button")!);

    await expect(resultado).resolves.toEqual({ ok: true, lead_id: "lead-123" });
    expect(fluxoOriginalSeguiu).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    const payload = JSON.parse(String(init.body)) as Record<string, string>;
    expect(payload).toMatchObject({
      nome: "Ana",
      telefone: "11999990000",
      utm_source: "instagram",
      utm_campaign: "lancamento",
      pagina: "Dia dos Professores",
    });
    expect(payload.external_id).toBeTruthy();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });
});
