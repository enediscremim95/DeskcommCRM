"use client";

import Link from "next/link";
import { useMemo } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useContactLeads } from "@/hooks/contacts/useContactLeads";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { useT } from "@/hooks/i18n/useT";
import { rotuloDoCampo, valorLegivel } from "@/lib/leads/dados-completos";
import { origemComUtms } from "@/lib/leads/utm-da-url";
import type { LeadComContexto } from "@/lib/types/leads";
import { Campo, dataLegivel, dinheiroLegivel, SecaoRecolhivel } from "./DadosCompletosDoLead";

interface Props {
  contactId: string | null;
  leadIdAtual: string;
}

const PRIORIDADE_DA_ORIGEM = [
  "origem",
  "source",
  "pagina",
  "page_url",
  "landing_page",
  "utm_campaign",
  "campaign_name",
  "campaign",
  "utm_content",
  "ad_name",
  "utm_term",
  "utm_source",
  "utm_medium",
];

function temValor(valor: unknown): boolean {
  return valorLegivel(valor) !== "-";
}

function ordenarOrigem(entradas: Array<[string, unknown]>): Array<[string, unknown]> {
  const posicao = new Map(PRIORIDADE_DA_ORIGEM.map((chave, indice) => [chave, indice]));
  return [...entradas].sort(([a], [b]) => {
    const pa = posicao.get(a) ?? Number.MAX_SAFE_INTEGER;
    const pb = posicao.get(b) ?? Number.MAX_SAFE_INTEGER;
    return pa === pb ? a.localeCompare(b, "pt-BR") : pa - pb;
  });
}

function ordenarNegocios(leads: LeadComContexto[]): LeadComContexto[] {
  return [...leads].sort((a, b) => {
    const prioridadeA = a.status === "open" ? 0 : 1;
    const prioridadeB = b.status === "open" ? 0 : 1;
    if (prioridadeA !== prioridadeB) return prioridadeA - prioridadeB;
    return b.created_at.localeCompare(a.created_at);
  });
}

function ContextoDoNegocio({ lead }: { lead: LeadComContexto }) {
  const t = useT();
  const locale = useTagDeIdioma();
  const origem = ordenarOrigem(
    origemComUtms(
      lead.source_metadata as Record<string, unknown> | null,
      Object.values(lead.custom_fields ?? {}),
    ).filter(([, valor]) => temValor(valor)),
  );
  const camposExtras = Object.entries(lead.custom_fields ?? {}).filter(([, valor]) =>
    temValor(valor),
  );

  return (
    <div className="space-y-3 pt-1">
      <dl className="grid grid-cols-1 gap-x-6 @3xl:grid-cols-2">
        <Campo rotulo={t("Origem")} valor={lead.source || t("Não informado")} />
        <Campo
          rotulo={t("Valor")}
          valor={dinheiroLegivel(lead.value_cents, lead.currency, locale)}
        />
        <Campo
          rotulo={t("Tags")}
          valor={lead.tags.length > 0 ? lead.tags : t("Nenhuma")}
        />
        {origem.map(([chave, valor]) => (
          <Campo key={`origem:${chave}`} rotulo={rotuloDoCampo(chave)} valor={valor} />
        ))}
        {camposExtras.map(([chave, valor]) => (
          <Campo
            key={`campo:${chave}`}
            rotulo={rotuloDoCampo(chave, lead.field_defs)}
            valor={valor}
          />
        ))}
      </dl>
    </div>
  );
}

function statusLegivel(status: LeadComContexto["status"], t: (texto: string) => string) {
  if (status === "won") return t("Ganho");
  if (status === "lost") return t("Perdido");
  return t("Aberto");
}

export function OutrosNegociosDoContato({ contactId, leadIdAtual }: Props) {
  const t = useT();
  const locale = useTagDeIdioma();
  const query = useContactLeads(contactId ?? "");
  const outros = useMemo(
    () => ordenarNegocios((query.data ?? []).filter((lead) => lead.id !== leadIdAtual)),
    [leadIdAtual, query.data],
  );
  const visiveis = outros.slice(0, 5);
  const abertos = outros.filter((lead) => lead.status === "open").length;

  if (!contactId || query.isLoading || query.isError || outros.length === 0) return null;

  const explicacao =
    abertos === 1
      ? t("Este contato tem outro negócio aberto. O contexto de onde ele veio está aqui.")
      : abertos > 1
        ? `${t("Este contato tem outros negócios abertos.")} ${t("O contexto de onde ele veio está aqui.")}`
        : t("Este contato tem outros negócios. O contexto de onde ele veio está aqui.");

  return (
    <div className="@container" data-testid="outros-negocios-do-contato">
      <SecaoRecolhivel
        sectionKey="outros-negocios"
        titulo={`${t("Outros negócios deste contato")} (${outros.length})`}
        defaultOpen={false}
      >
        <div className="space-y-3 pt-1">
          <p className="text-sm text-text-muted">{explicacao}</p>
          {outros.length > visiveis.length ? (
            <p className="text-xs text-text-muted">
              {t("Mostrando os 5 negócios mais recentes, com os abertos primeiro.")}
            </p>
          ) : null}
          <div className="space-y-2">
            {visiveis.map((lead) => (
              <article
                key={lead.id}
                className="rounded-lg border border-border bg-surface-elevated/40 p-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="min-w-0 break-words text-sm font-medium text-text">
                        {lead.title}
                      </h3>
                      <Badge
                        variant={
                          lead.status === "lost"
                            ? "destructive"
                            : lead.status === "won"
                              ? "success"
                              : "neutral"
                        }
                      >
                        {statusLegivel(lead.status, t)}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-text-muted">
                      {lead.pipeline_name} · {lead.stage_name}
                    </p>
                    <p className="mt-0.5 text-xs text-text-muted">
                      {t("Criado em")}: {dataLegivel(lead.created_at, locale)}
                    </p>
                    <p className="mt-0.5 text-xs text-text-muted">
                      {t("Origem")}: {lead.source || t("Não informado")}
                    </p>
                  </div>
                  <Button
                    asChild
                    size="sm"
                    variant="ghost"
                    className="h-7 shrink-0 px-2 text-xs"
                  >
                    <Link href={`/app/leads/${lead.id}`}>{t("Abrir negócio")}</Link>
                  </Button>
                </div>

                <div className="mt-3 border-t border-border pt-3">
                  <SecaoRecolhivel
                    sectionKey={`outro-negocio:${lead.id}`}
                    titulo={t("Contexto")}
                    defaultOpen={false}
                  >
                    <ContextoDoNegocio lead={lead} />
                  </SecaoRecolhivel>
                </div>
              </article>
            ))}
          </div>
        </div>
      </SecaoRecolhivel>
    </div>
  );
}
