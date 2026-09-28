/**
 * Integração copiável para landing pages estáticas.
 *
 * O script segura o primeiro submit somente pelo tempo necessário para confirmar
 * a captação. Depois, reenvia o submit original para preservar WhatsApp,
 * redirecionamento ou qualquer handler que a página já possua.
 */
export function gerarSnippetDaLandingPage(url: string, pagina: string): string {
  const endpoint = JSON.stringify(url).replaceAll("</", "<\\/");
  const nomeDaPagina = JSON.stringify(pagina).replaceAll("</", "<\\/");

  return `<!-- Adicione data-crm-lead ao formulário da landing page e cole este script depois dele. -->
<script>
(() => {
  const endpoint = ${endpoint};
  const pagina = ${nomeDaPagina};
  const emFluxoOriginal = new WeakSet();
  const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const novoId = () =>
    globalThis.crypto?.randomUUID?.() ||
    "lp-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);

  async function enviar(payload) {
    let ultimoStatus = 0;
    for (let tentativa = 0; tentativa < 2; tentativa += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2500);
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          mode: "cors",
          credentials: "omit",
          keepalive: true,
          signal: controller.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        ultimoStatus = response.status;
        const body = await response.json().catch(() => null);
        if (response.ok && body?.data?.lead_id) {
          return { ok: true, lead_id: body.data.lead_id };
        }
        if (![408, 425].includes(response.status) && response.status < 500) break;
      } catch {
        // Falha de rede ou timeout: a segunda tentativa usa o mesmo external_id.
      } finally {
        clearTimeout(timeout);
      }
      if (tentativa === 0) await esperar(350);
    }
    return { ok: false, status: ultimoStatus };
  }

  document.addEventListener("submit", async (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || !form.matches("form[data-crm-lead]")) return;
    if (emFluxoOriginal.has(form)) {
      emFluxoOriginal.delete(form);
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();

    const submitter = event.submitter;
    const payload = {};
    for (const [key, value] of new FormData(form).entries()) {
      if (typeof value === "string") payload[key] = value;
    }
    for (const [key, value] of new URLSearchParams(location.search).entries()) {
      if (key.toLowerCase().startsWith("utm_") && payload[key] == null) payload[key] = value;
    }
    if (payload.pagina == null) payload.pagina = pagina;

    let externalId = form.querySelector('input[name="external_id"]');
    const externalIdInformado =
      externalId instanceof HTMLInputElement && externalId.dataset.crmGenerated !== "true"
        ? payload.external_id
        : null;
    delete payload.external_id;

    const fingerprint = JSON.stringify(payload);
    if (form.dataset.crmFingerprint !== fingerprint) {
      form.dataset.crmFingerprint = fingerprint;
      form.dataset.crmExternalId = externalIdInformado || novoId();
    }
    payload.external_id = form.dataset.crmExternalId;

    if (!(externalId instanceof HTMLInputElement)) {
      externalId = document.createElement("input");
      externalId.type = "hidden";
      externalId.name = "external_id";
      externalId.dataset.crmGenerated = "true";
      form.append(externalId);
    }
    externalId.value = payload.external_id;

    const resultado = await enviar(payload);
    if (!resultado.ok && typeof navigator.sendBeacon === "function") {
      navigator.sendBeacon(endpoint, JSON.stringify(payload));
    }
    form.dispatchEvent(new CustomEvent("crm:lead", { bubbles: true, detail: resultado }));

    emFluxoOriginal.add(form);
    if (typeof form.requestSubmit === "function") form.requestSubmit(submitter || undefined);
    else form.submit();
  }, true);
})();
</script>`;
}
