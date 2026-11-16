import { assertDestinoResolvidoSeguro } from "@/lib/automation/outbound-ip";
import { urlDeFotoPermitida } from "@/lib/catalogo/hosts-de-foto";

export const MAX_BYTES_FOTO_PAINEL = 5 * 1024 * 1024;
const TIMEOUT_MS = 5_000;
const MAX_REDIRECIONAMENTOS = 3;

export interface FotoBaixadaDoPainel {
  bytes: Uint8Array;
  mime: "image/jpeg" | "image/png";
  extensao: "jpg" | "png";
}

interface DependenciasDaFoto {
  fetchImpl?: typeof fetch;
  resolver?: (hostname: string) => Promise<void>;
}

export function tipoPelosBytes(bytes: Uint8Array): Omit<FotoBaixadaDoPainel, "bytes"> | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mime: "image/jpeg", extensao: "jpg" };
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return { mime: "image/png", extensao: "png" };
  }
  return null;
}

async function lerComTeto(resposta: Response): Promise<Uint8Array> {
  const declarado = Number(resposta.headers.get("content-length") ?? 0);
  if (Number.isFinite(declarado) && declarado > MAX_BYTES_FOTO_PAINEL) {
    throw new Error("foto_maior_que_5mb");
  }
  if (!resposta.body) throw new Error("foto_sem_corpo");

  const leitor = resposta.body.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await leitor.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES_FOTO_PAINEL) {
      await leitor.cancel();
      throw new Error("foto_maior_que_5mb");
    }
    partes.push(value);
  }
  const bytes = new Uint8Array(total);
  let deslocamento = 0;
  for (const parte of partes) {
    bytes.set(parte, deslocamento);
    deslocamento += parte.byteLength;
  }
  return bytes;
}

/**
 * Baixa sem seguir redirect automaticamente. Cada salto repete allowlist e DNS.
 * O Content-Type não decide o formato, a assinatura dos bytes decide.
 */
export async function baixarFotoDoPainel(
  origem: string,
  deps: DependenciasDaFoto = {},
): Promise<FotoBaixadaDoPainel> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const resolver = deps.resolver ?? assertDestinoResolvidoSeguro;
  let atual = urlDeFotoPermitida(origem);

  for (let salto = 0; salto <= MAX_REDIRECIONAMENTOS; salto += 1) {
    await resolver(atual.hostname);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("foto_timeout")), TIMEOUT_MS);
    try {
      const resposta = await fetchImpl(atual, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: { Accept: "image/jpeg, image/png" },
      });
      if (resposta.status >= 300 && resposta.status < 400) {
        const location = resposta.headers.get("location");
        if (!location) throw new Error("foto_redirect_sem_destino");
        if (salto === MAX_REDIRECIONAMENTOS) throw new Error("foto_redirect_demais");
        atual = urlDeFotoPermitida(new URL(location, atual).toString());
        continue;
      }
      if (!resposta.ok) throw new Error(`foto_http_${resposta.status}`);

      const bytes = await lerComTeto(resposta);
      const tipo = tipoPelosBytes(bytes);
      if (!tipo) throw new Error("foto_bytes_invalidos");
      return { bytes, ...tipo };
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error("foto_redirect_demais");
}
