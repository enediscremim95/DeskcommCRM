import { randomUUID } from "node:crypto";

import { fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import {
  dataDoArquivo,
  montarCsvDeLeads,
  slugSeguroParaArquivo,
  type LeadParaExportacao,
} from "@/lib/leads/exportar-csv";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const MAX_LEADS_POR_EXPORTACAO = 20_000;
const TAMANHO_DA_PAGINA = 1_000;

interface ContatoDoBanco {
  display_name: string | null;
  email: string | null;
  name: string | null;
  organization_id: string;
  phone_number: string | null;
}

interface EtapaDoBanco {
  name: string;
  organization_id: string;
}

interface LeadDoBanco {
  contacts: ContatoDoBanco | ContatoDoBanco[] | null;
  created_at: string;
  crm_stages: EtapaDoBanco | EtapaDoBanco[] | null;
  custom_fields: unknown;
  last_activity_at: string | null;
  lost_reason: string | null;
  lost_reason_detail?: string | null;
  organization_id: string;
  source: string | null;
  status: string;
  tags: string[] | null;
}

function primeiro<T>(valor: T | T[] | null): T | null {
  return Array.isArray(valor) ? (valor[0] ?? null) : valor;
}

function noStore<T extends Response>(response: T): T {
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function paraExportacao(linha: LeadDoBanco, organizationId: string): LeadParaExportacao {
  const contato = primeiro(linha.contacts);
  const etapa = primeiro(linha.crm_stages);
  return {
    created_at: linha.created_at,
    custom_fields: linha.custom_fields,
    last_activity_at: linha.last_activity_at,
    lost_reason: linha.lost_reason,
    lost_reason_detail: linha.lost_reason_detail ?? null,
    source: linha.source,
    status: linha.status,
    tags: linha.tags,
    contato: contato?.organization_id === organizationId ? contato : null,
    etapa: etapa?.organization_id === organizationId ? etapa : null,
  };
}

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "crm_leads" });
  if (!authz.ok) return noStore(authz.response);

  const organizationId = authz.org.orgId;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const supabase = await createClient();

  const [organizacao, contagem] = await Promise.all([
    supabase.from("organizations").select("slug").eq("id", organizationId).maybeSingle(),
    supabase
      .from("crm_leads")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId),
  ]);

  if (organizacao.error || contagem.error || !organizacao.data || contagem.count === null) {
    return noStore(
      fail("internal_error", t("Não foi possível preparar a exportação de leads."), 500, {
        requestId,
      }),
    );
  }

  if (contagem.count > MAX_LEADS_POR_EXPORTACAO) {
    return noStore(
      fail(
        "payload_too_large",
        t("Há mais de 20.000 leads. Reduza a quantidade antes de baixar."),
        413,
        { requestId },
      ),
    );
  }

  const leads: LeadParaExportacao[] = [];
  for (let inicio = 0; inicio < contagem.count; inicio += TAMANHO_DA_PAGINA) {
    const fim = Math.min(inicio + TAMANHO_DA_PAGINA - 1, contagem.count - 1);
    const { data, error } = await supabase
      .from("crm_leads")
      .select(
        "organization_id, created_at, custom_fields, last_activity_at, lost_reason, lost_reason_detail, source, status, tags, contacts!crm_leads_contact_id_fkey(display_name, name, phone_number, email, organization_id), crm_stages!crm_leads_stage_id_fkey(name, organization_id)",
      )
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(inicio, fim);

    if (error || !data) {
      return noStore(
        fail("internal_error", t("Não foi possível preparar a exportação de leads."), 500, {
          requestId,
        }),
      );
    }
    leads.push(
      ...(data as unknown as LeadDoBanco[]).map((linha) => paraExportacao(linha, organizationId)),
    );
  }

  if (leads.length !== contagem.count) {
    return noStore(
      fail("internal_error", t("Não foi possível preparar a exportação de leads."), 500, {
        requestId,
      }),
    );
  }

  await audit({
    action: "lead.exported",
    actorUserId: authz.user.id,
    organizationId,
    resourceType: "crm_leads",
    requestId,
    metadata: { quantidade_linhas: leads.length },
  });

  const slug = slugSeguroParaArquivo(organizacao.data.slug);
  const nome = `leads-${slug}-${dataDoArquivo(new Date())}.csv`;
  return new Response(montarCsvDeLeads(leads), {
    status: 200,
    headers: {
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="${nome}"`,
      "Content-Type": "text/csv; charset=utf-8",
      "X-Request-Id": requestId,
    },
  });
}
