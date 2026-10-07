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
  const telefoneInvalidoAvisado = new WeakMap();
  const seletorTelefone = [
    'input[type="tel"]',
    'input[name*="tel" i]',
    'input[id*="tel" i]',
    'input[name*="fone" i]',
    'input[id*="fone" i]',
    'input[name*="whats" i]',
    'input[id*="whats" i]',
    'input[name*="celular" i]',
    'input[id*="celular" i]',
  ].join(",");
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

  function campoDeTelefone(form) {
    const input = form.querySelector(seletorTelefone);
    return input instanceof HTMLInputElement ? input : null;
  }

  function dddValido(digits, offset) {
    return /^[1-9]\\d$/.test(digits.slice(offset, offset + 2));
  }

  function formatarTelefoneLeve(raw) {
    const internacional = raw.trim().startsWith("+");
    const digits = raw.replace(/\\D/g, "");
    if (internacional && digits.startsWith("55")) {
      const nacional = digits.slice(2, 13);
      if (nacional.length <= 2) return "+55 " + nacional;
      const ddd = nacional.slice(0, 2);
      const local = nacional.slice(2);
      if (local.length <= 4) return "+55 (" + ddd + ") " + local;
      const corte = local.length <= 8 ? 4 : 5;
      return "+55 (" + ddd + ") " + local.slice(0, corte) + "-" + local.slice(corte);
    }
    if (!internacional && (digits.length === 10 || digits.length === 11)) {
      const ddd = digits.slice(0, 2);
      const local = digits.slice(2);
      const corte = local.length === 8 ? 4 : 5;
      return "(" + ddd + ") " + local.slice(0, corte) + "-" + local.slice(corte);
    }
    return (internacional ? "+" : "") + digits.slice(0, internacional ? 15 : 13);
  }

  function limparTroncoAoSair(input) {
    const raw = input.value;
    const internacional = raw.trim().startsWith("+");
    let digits = raw.replace(/\\D/g, "");
    if (
      !internacional &&
      (digits.length === 11 || digits.length === 12) &&
      digits.startsWith("0") &&
      dddValido(digits, 1)
    ) {
      digits = digits.slice(1);
    }
    input.value = formatarTelefoneLeve((internacional ? "+" : "") + digits);
  }

  function telefoneValido(input) {
    const raw = input.value.trim();
    const digits = raw.replace(/\\D/g, "");
    if (raw.startsWith("+")) {
      return digits.startsWith("55") &&
        (digits.length === 12 || digits.length === 13) &&
        dddValido(digits, 2);
    }
    return (digits.length === 10 || digits.length === 11) && dddValido(digits, 0);
  }

  function limparErroDoTelefone(input) {
    input.removeAttribute("aria-invalid");
    const proximo = input.nextElementSibling;
    if (proximo?.matches('[data-crm-phone-error="true"]')) proximo.remove();
  }

  function mostrarErroDoTelefone(input) {
    limparErroDoTelefone(input);
    input.setAttribute("aria-invalid", "true");
    const mensagem = document.createElement("span");
    mensagem.dataset.crmPhoneError = "true";
    mensagem.setAttribute("role", "alert");
    mensagem.textContent = "Confira seu WhatsApp com DDD. Exemplo: (41) 99999-9999";
    mensagem.style.cssText =
      "display:block;margin-top:6px;color:#b42318;font:500 13px/1.35 system-ui,sans-serif;";
    input.insertAdjacentElement("afterend", mensagem);
  }

  document.addEventListener("input", (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || !input.matches(seletorTelefone)) return;
    if (!input.closest("form[data-crm-lead]")) return;
    input.value = formatarTelefoneLeve(input.value);
    telefoneInvalidoAvisado.delete(input);
    limparErroDoTelefone(input);
  }, true);

  document.addEventListener("blur", (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || !input.matches(seletorTelefone)) return;
    if (!input.closest("form[data-crm-lead]")) return;
    limparTroncoAoSair(input);
  }, true);

  document.addEventListener("submit", async (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || !form.matches("form[data-crm-lead]")) return;
    if (emFluxoOriginal.has(form)) {
      emFluxoOriginal.delete(form);
      return;
    }

    const telefone = campoDeTelefone(form);
    if (telefone) {
      limparTroncoAoSair(telefone);
      if (!telefoneValido(telefone)) {
        if (telefoneInvalidoAvisado.get(telefone) !== telefone.value) {
          telefoneInvalidoAvisado.set(telefone, telefone.value);
          mostrarErroDoTelefone(telefone);
          event.preventDefault();
          event.stopImmediatePropagation();
          telefone.focus();
          return;
        }
        limparErroDoTelefone(telefone);
      } else {
        telefoneInvalidoAvisado.delete(telefone);
        limparErroDoTelefone(telefone);
      }
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
