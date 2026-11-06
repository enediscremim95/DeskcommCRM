/**
 * Configuração de referência da Sublimando Paraná:
 *
 * organization_id: 7f99071c-43a9-4766-83cb-39d99bc4a80b
 * slug: confirmar no banco antes de executar
 * origem: 83320-590, Pinhais/PR
 * base: https://melhorenvio.com.br/api/v2
 * faixas locais: 80000-83999
 *
 * O token nunca entra em argumento. Defina MELHOR_ENVIO_TOKEN somente no
 * ambiente do processo. A execução é simulação até receber --aplicar.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { cifrarTokenDeFrete } from "../lib/frete/segredo";
import { createAdminClient } from "../lib/supabase/admin";

const COM_VALOR = new Set([
  "--org-id",
  "--slug",
  "--cep-origem",
  "--base-url",
  "--user-agent",
  "--servicos",
  "--valor-declarado",
  "--margem-embalagem-centavos",
  "--faixas-locais",
]);
const BOOLEANOS = new Set(["--aplicar", "--ativar"]);

function argumentos(argv: string[]): Record<string, string | boolean> {
  const saida: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const nome = argv[i]!;
    if (nome === "--token" || nome.startsWith("--token=")) {
      throw new Error("token_somente_por_MELHOR_ENVIO_TOKEN");
    }
    if (BOOLEANOS.has(nome)) {
      if (nome in saida) throw new Error(`argumento_duplicado:${nome}`);
      saida[nome] = true;
      continue;
    }
    if (!COM_VALOR.has(nome)) throw new Error(`argumento_desconhecido:${nome}`);
    if (nome in saida) throw new Error(`argumento_duplicado:${nome}`);
    const valor = argv[i + 1];
    if (!valor || valor.startsWith("--")) throw new Error(`argumento_sem_valor:${nome}`);
    saida[nome] = valor;
    i += 1;
  }
  return saida;
}

const schema = z.object({
  "--org-id": z.string().uuid(),
  "--slug": z.string().trim().min(1).max(120),
  "--cep-origem": z.string().regex(/^\d{5}-?\d{3}$/u),
  "--base-url": z.string().url(),
  "--user-agent": z
    .string()
    .trim()
    .min(1)
    .max(200)
    .refine((v) => !/[\r\n]/u.test(v)),
  "--servicos": z.string().regex(/^\d+(?:,\d+)*$/u),
  "--valor-declarado": z.enum(["subtotal", "zero"]),
  "--margem-embalagem-centavos": z.coerce.number().int().nonnegative(),
  "--faixas-locais": z.string().regex(/^\d{5}-\d{5}(?:,\d{5}-\d{5})*$/u),
  "--aplicar": z.boolean().optional().default(false),
  "--ativar": z.boolean().optional().default(false),
});

function validarBase(valor: string): string {
  const url = new URL(valor);
  const hostPermitido =
    url.protocol === "https:" &&
    (url.hostname === "melhorenvio.com.br" || url.hostname.endsWith(".melhorenvio.com.br"));
  const path = url.pathname.replace(/\/+$/u, "");
  if (
    !hostPermitido ||
    path !== "/api/v2" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error("base_url_invalida");
  }
  url.pathname = path;
  return url.toString().replace(/\/$/u, "");
}

async function main(): Promise<void> {
  const entrada = schema.parse(argumentos(process.argv.slice(2)));
  const token = process.env.MELHOR_ENVIO_TOKEN;
  if (!token) throw new Error("MELHOR_ENVIO_TOKEN_ausente");

  const baseUrl = validarBase(entrada["--base-url"]);
  const servicos = [...new Set(entrada["--servicos"].split(",").map(Number))];
  const faixas = entrada["--faixas-locais"].split(",");
  const admin = createAdminClient() as unknown as SupabaseClient;
  const { data: org, error } = await admin
    .from("organizations")
    .select("id,slug")
    .eq("id", entrada["--org-id"])
    .eq("slug", entrada["--slug"])
    .maybeSingle();
  if (error || !org) throw new Error("organizacao_nao_confere");

  if (entrada["--aplicar"]) {
    const { error: gravacao } = await admin.from("organization_shipping_settings").upsert(
      {
        organization_id: entrada["--org-id"],
        provider: "melhor_envio",
        base_url: baseUrl,
        user_agent: entrada["--user-agent"],
        origin_postal_code: entrada["--cep-origem"].replace("-", ""),
        token_ciphertext: cifrarTokenDeFrete(token),
        service_allowlist: servicos,
        declared_value_mode: entrada["--valor-declarado"],
        packaging_margin_cents: entrada["--margem-embalagem-centavos"],
        local_postal_ranges: faixas,
        ativo: entrada["--ativar"],
      },
      { onConflict: "organization_id" },
    );
    if (gravacao) throw new Error("configuracao_frete_falhou");
  }

  process.stdout.write(
    `${entrada["--aplicar"] ? "APLICADO" : "SIMULAÇÃO"} ` +
      `org_id=${entrada["--org-id"]} slug=${entrada["--slug"]} ` +
      `cep_origem=${entrada["--cep-origem"].replace("-", "")} ` +
      `base_url=${baseUrl} servicos=${servicos.join(",")} ` +
      `valor_declarado=${entrada["--valor-declarado"]} ` +
      `margem_centavos=${entrada["--margem-embalagem-centavos"]} ` +
      `faixas_locais=${faixas.join(",")} ativo=${entrada["--ativar"]}\n`,
  );
}

void main().catch((falha: unknown) => {
  process.stderr.write(`${falha instanceof Error ? falha.message : "erro_desconhecido"}\n`);
  process.exitCode = 1;
});
