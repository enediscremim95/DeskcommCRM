/**
 * Reencontra o cadastro pelas grafias do mesmo número (nono dígito BR).
 * Sem isto, captação e WhatsApp viram dois contatos e o follow-up não vê a resposta.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { canonicalPhoneBR, phoneLookupVariants } from "./phone-variants";

/** O que toda busca por telefone precisa saber para escolher, e mais nada. */
export interface ContatoCandidato {
  id: string;
  phone_number: string | null;
}

/**
 * QUAL DAS GRAFIAS VENCE — a regra, separada da consulta de propósito.
 *
 * ## O defeito que ela fecha
 *
 * A busca era `.in("phone_number", variantes).limit(1)`, **sem `order by`**.
 * `+55 32 8479-3302` e `+55 32 98479-3302` são a mesma pessoa e são DUAS linhas
 * enquanto a fusão da migration `0198` não passou por elas — e sem ordenação o
 * Postgres devolve qualquer uma das duas. Não é hipótese de laboratório: a
 * própria `0198` chama o passo que trata o resto de "piso de segurança para o
 * unique", ou seja, ela já admite que pode sobrar par.
 *
 * O estrago, quando a linha errada volta: a resposta do cliente entra no
 * cadastro errado, o follow-up não a reconhece como resposta, e a mesma
 * pergunta é enviada de novo — exatamente o sintoma que a `0198` existe para
 * acabar.
 *
 * ## Por que a canônica, e por que ela sempre existe no par
 *
 * `canonicalPhoneBR` já define a forma que o CRM grava e mostra: celular BR
 * **com** o nono dígito. Para um par de grafias, `phoneLookupVariants` devolve
 * no máximo duas formas e **uma delas é sempre a canônica** — então preferi-la
 * decide o par inteiro, sem depender de ordenação nenhuma.
 *
 * Fixo e número estrangeiro têm variante única, e o índice parcial
 * `uniq_contacts_org_phone` garante no máximo uma linha ativa: ali não há o que
 * desempatar.
 *
 * ## O desempate final é arbitrário DE PROPÓSITO
 *
 * Se nenhuma candidata for a canônica — estado que não deveria existir —, vence
 * o menor `id`. Não é uma escolha com significado: é uma escolha **estável**.
 * Devolver "qualquer uma" é o defeito; devolver sempre a mesma é o conserto,
 * mesmo quando a regra de negócio não tem preferência.
 */
export function escolherContatoCanonico<T extends ContatoCandidato>(
  candidatos: readonly T[],
  rawPhone: string,
): T | null {
  if (candidatos.length === 0) return null;
  const canonica = canonicalPhoneBR(rawPhone);
  const exata = candidatos.filter((c) => c.phone_number === canonica);
  const pool = exata.length > 0 ? exata : candidatos;
  return [...pool].sort((a, b) => a.id.localeCompare(b.id))[0]!;
}

/**
 * Busca por todas as grafias e devolve UMA, sempre a mesma.
 *
 * `limit(4)` e não `limit(1)`: com `limit(1)` a escolha é do banco, e é ela que
 * era não-determinística. Quatro é folga sobre as duas grafias possíveis — se
 * aparecerem mais, é dado corrompido, e ainda assim a saída é estável.
 */
async function buscarPorVariantes(
  admin: SupabaseClient,
  orgId: string,
  rawPhone: string,
  colunas: string,
): Promise<Record<string, unknown> | null> {
  const variantes = phoneLookupVariants(rawPhone);
  if (variantes.length === 0) return null;
  const { data } = await admin
    .from("contacts")
    .select(colunas)
    .eq("organization_id", orgId)
    .in("phone_number", variantes)
    // Contato FUNDIDO não é alvo: ele aponta para o vencedor da fusão, e
    // escrever nele é escrever num cadastro que ninguém mais lê. Dois dos
    // quatro chamadores desta busca não filtravam isto — ver o cabeçalho do
    // conserto.
    .is("is_merged_into", null)
    .limit(4);
  const linhas = (data ?? []) as unknown as ContatoCandidato[];
  return (escolherContatoCanonico(linhas, rawPhone) as Record<string, unknown> | null) ?? null;
}

export async function encontrarContatoPorTelefone(
  admin: SupabaseClient,
  orgId: string,
  rawPhone: string,
): Promise<{ id: string; phone_number: string } | null> {
  const linha = await buscarPorVariantes(admin, orgId, rawPhone, "id, phone_number");
  return (linha as { id: string; phone_number: string } | null) ?? null;
}

/** Como `encontrarContatoPorTelefone`, mas trazendo o nome de quem já existia. */
export async function encontrarContatoPorTelefoneComNome(
  admin: SupabaseClient,
  orgId: string,
  rawPhone: string,
): Promise<{ id: string; phone_number: string | null; name: string | null } | null> {
  const linha = await buscarPorVariantes(admin, orgId, rawPhone, "id, phone_number, name");
  return (linha as { id: string; phone_number: string | null; name: string | null } | null) ?? null;
}

export interface EncontrarOuCriarContatoPorTelefoneInput {
  organizationId: string;
  phone: string;
  name: string;
  email?: string | null;
  source: string;
  sourceMetadata?: Record<string, unknown>;
  consent?: unknown;
}

export interface ContatoPorTelefoneResolvido {
  contato: { id: string; phone_number: string | null; name: string | null } | null;
  criado: boolean;
  error?: { code?: string; message: string };
}

/**
 * Caminho único da captação para reencontrar ou criar um contato por telefone.
 *
 * O filtro de organização é explícito em todas as consultas porque este helper
 * recebe o client admin, que bypassa RLS. A colisão 23505 é tratada como corrida:
 * relê primeiro por telefone e, se necessário, pelo e-mail normalizado.
 */
export async function encontrarOuCriarContatoPorTelefone(
  admin: SupabaseClient,
  input: EncontrarOuCriarContatoPorTelefoneInput,
): Promise<ContatoPorTelefoneResolvido> {
  const existente = await encontrarContatoPorTelefoneComNome(
    admin,
    input.organizationId,
    input.phone,
  );
  if (existente) return { contato: existente, criado: false };

  const { data: criado, error } = await admin
    .from("contacts")
    .insert({
      organization_id: input.organizationId,
      name: input.name,
      phone_number: input.phone,
      email: input.email ?? null,
      source: input.source,
      source_metadata: input.sourceMetadata ?? {},
      ...(input.consent !== undefined ? { consent: input.consent } : {}),
    })
    .select("id, phone_number, name")
    .maybeSingle();

  if (!error) {
    return {
      contato: (criado as { id: string; phone_number: string | null; name: string | null } | null) ?? null,
      criado: criado !== null,
    };
  }
  if (error.code !== "23505") {
    return { contato: null, criado: false, error: { code: error.code, message: error.message } };
  }

  const vencedorPorTelefone = await encontrarContatoPorTelefoneComNome(
    admin,
    input.organizationId,
    input.phone,
  );
  if (vencedorPorTelefone) return { contato: vencedorPorTelefone, criado: false };

  if (input.email) {
    const { data: vencedorPorEmail } = await admin
      .from("contacts")
      .select("id, phone_number, name")
      .eq("organization_id", input.organizationId)
      .eq("email_normalized", input.email.trim().toLowerCase())
      .is("is_merged_into", null)
      .maybeSingle();
    if (vencedorPorEmail) {
      return {
        contato: vencedorPorEmail as {
          id: string;
          phone_number: string | null;
          name: string | null;
        },
        criado: false,
      };
    }
  }

  return { contato: null, criado: false, error: { code: error.code, message: error.message } };
}

/** O contato da mensagem e os gêmeos gravados com a outra grafia do número. */
export async function idsDoContatoEGemeos(
  admin: SupabaseClient,
  orgId: string,
  contactId: string,
): Promise<string[]> {
  const ids = new Set<string>([contactId]);
  const { data: me } = await admin
    .from("contacts")
    .select("phone_number")
    .eq("organization_id", orgId)
    .eq("id", contactId)
    .maybeSingle();
  const phone = typeof me?.phone_number === "string" ? me.phone_number : null;
  if (!phone) return [...ids];
  const variantes = phoneLookupVariants(phone);
  if (variantes.length === 0) return [...ids];
  // Aqui NÃO se escolhe uma: o objetivo é o conjunto inteiro dos gêmeos, e
  // `limit` nenhum entra. Esta busca nunca teve o defeito das outras.
  const { data: gemeos } = await admin
    .from("contacts")
    .select("id")
    .eq("organization_id", orgId)
    .in("phone_number", variantes)
    .is("is_merged_into", null);
  for (const row of gemeos ?? []) {
    if (typeof row.id === "string") ids.add(row.id);
  }
  return [...ids];
}
