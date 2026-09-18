"use client";

import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { useT } from "@/hooks/i18n/useT";
import { historicoEstruturado, rotuloDoCampo, valorLegivel } from "@/lib/leads/dados-completos";
import type { CustomFieldDef } from "@/lib/schemas/settings";
import type { Lead } from "@/lib/types/leads";

interface Props {
  lead: Lead;
  pipelineName?: string;
  stageName?: string;
  fieldDefs?: CustomFieldDef[];
  conversationId?: string | null;
}

function dataLegivel(valor: string | null | undefined, locale: string): string {
  if (!valor) return "-";
  if (/^\d{4}-\d{2}-\d{2}$/.test(valor)) {
    const [ano, mes, dia] = valor.split("-");
    return `${dia}/${mes}/${ano}`;
  }
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) return valor;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "short",
    timeStyle: "short",
  }).format(data);
}

function dinheiroLegivel(centavos: number | null, moeda: string | null, locale: string): string {
  if (centavos === null) return "-";
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: moeda || "BRL",
    }).format(centavos / 100);
  } catch {
    return `${(centavos / 100).toFixed(2)} ${moeda || "BRL"}`;
  }
}

function Campo({ rotulo, valor }: { rotulo: string; valor: unknown }) {
  const texto = valorLegivel(valor);
  const multilinha = typeof valor === "object" && valor !== null;
  return (
    <div className="bg-surface-muted/20 min-w-0 rounded-md border border-border p-2.5">
      <dt className="text-[11px] font-medium tracking-wide text-text-muted uppercase">{rotulo}</dt>
      <dd
        className={
          multilinha
            ? "mt-1 font-mono text-xs break-words whitespace-pre-wrap"
            : "mt-1 text-sm break-words"
        }
      >
        {texto}
      </dd>
    </div>
  );
}

function Historico({ itens, fieldDefs }: { itens: unknown[]; fieldDefs: CustomFieldDef[] }) {
  return (
    <ol className="space-y-2 border-l border-border pl-4">
      {itens.map((item, indice) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
          return (
            <li key={indice} className="text-sm">
              {valorLegivel(item)}
            </li>
          );
        }
        const entradas = Object.entries(item as Record<string, unknown>);
        return (
          <li
            key={indice}
            className="relative rounded-md border border-border p-2.5 text-sm before:absolute before:top-4 before:-left-[21px] before:h-2 before:w-2 before:rounded-full before:bg-accent"
          >
            <dl className="grid gap-1.5">
              {entradas.map(([chave, valor]) => (
                <div key={chave} className="grid grid-cols-[minmax(7rem,0.35fr)_1fr] gap-2">
                  <dt className="text-xs text-text-muted">{rotuloDoCampo(chave, fieldDefs)}</dt>
                  <dd className="break-words whitespace-pre-wrap">{valorLegivel(valor)}</dd>
                </div>
              ))}
            </dl>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Uma apresentação única para a ficha do contato e o dossiê do Kanban.
 * Campos declarados ganham o rótulo do funil; os demais continuam visíveis com
 * rótulo derivado da chave. Assim importação, webhook e WhatsApp não dependem
 * de configuração posterior para o dado aparecer.
 */
export function DadosCompletosDoLead({
  lead,
  pipelineName,
  stageName,
  fieldDefs = [],
  conversationId,
}: Props) {
  const t = useT();
  const locale = useTagDeIdioma();
  const historico = historicoEstruturado(lead.custom_fields?.historico);
  const campos = Object.entries(lead.custom_fields ?? {}).filter(
    ([chave]) => chave !== "historico",
  );
  const origem = Object.entries(lead.source_metadata ?? {});

  return (
    <div className="space-y-4" data-testid={`dados-completos-lead-${lead.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{stageName ?? t("Não informado")}</Badge>
        <Badge
          variant={
            lead.status === "lost" ? "destructive" : lead.status === "won" ? "success" : "neutral"
          }
        >
          {lead.status === "won" ? t("Ganho") : lead.status === "lost" ? t("Perdido") : t("Aberto")}
        </Badge>
        <div className="ml-auto flex flex-wrap gap-1.5">
          {lead.contact_id && (
            <Button asChild size="sm" variant="ghost" className="h-7 px-2 text-xs">
              <Link href={`/app/contacts/${lead.contact_id}`}>{t("Ver contato")}</Link>
            </Button>
          )}
          <Button asChild size="sm" variant="ghost" className="h-7 px-2 text-xs">
            <Link href={`/app/pipelines/${lead.pipeline_id}?lead=${lead.id}`}>
              {t("Abrir no quadro")}
            </Link>
          </Button>
          {(conversationId ?? lead.conversa?.id) && (
            <Button asChild size="sm" variant="ghost" className="h-7 px-2 text-xs">
              <Link href={`/app/inbox?id=${conversationId ?? lead.conversa?.id}`}>
                {t("Abrir conversa")}
              </Link>
            </Button>
          )}
        </div>
      </div>

      <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Campo rotulo={t("Título")} valor={lead.title} />
        <Campo rotulo={t("Funil")} valor={pipelineName ?? t("Não informado")} />
        <Campo rotulo={t("Etapa")} valor={stageName ?? t("Não informado")} />
        <Campo
          rotulo={t("Valor")}
          valor={dinheiroLegivel(lead.value_cents, lead.currency, locale)}
        />
        <Campo rotulo={t("Origem")} valor={lead.source} />
        <Campo rotulo={t("Atribuído em")} valor={dataLegivel(lead.assigned_at, locale)} />
        <Campo
          rotulo={t("Previsão de fechamento")}
          valor={dataLegivel(lead.expected_close_date, locale)}
        />
        <Campo rotulo={t("Fechado em")} valor={dataLegivel(lead.closed_at, locale)} />
        <Campo rotulo={t("Motivo da perda")} valor={lead.lost_reason} />
        <Campo rotulo={t("Tags")} valor={lead.tags} />
        <Campo rotulo={t("Descrição")} valor={lead.description} />
        <Campo rotulo={t("Identificador externo")} valor={lead.external_id} />
        <Campo rotulo={t("Criado em")} valor={dataLegivel(lead.created_at, locale)} />
        <Campo rotulo={t("Atualizado em")} valor={dataLegivel(lead.updated_at, locale)} />
        <Campo rotulo={t("Última atividade")} valor={dataLegivel(lead.last_activity_at, locale)} />
      </dl>

      <section>
        <h4 className="mb-2 text-xs font-medium tracking-wide text-text-muted uppercase">
          {t("Dados informados")}
        </h4>
        {campos.length > 0 ? (
          <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {campos.map(([chave, valor]) => (
              <Campo key={chave} rotulo={rotuloDoCampo(chave, fieldDefs)} valor={valor} />
            ))}
          </dl>
        ) : (
          <p className="text-sm text-text-muted">{t("Nenhum campo adicional informado.")}</p>
        )}
      </section>

      <section>
        <h4 className="mb-2 text-xs font-medium tracking-wide text-text-muted uppercase">
          {t("Origem, campanha e anúncio")}
        </h4>
        {origem.length > 0 ? (
          <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {origem.map(([chave, valor]) => (
              <Campo key={chave} rotulo={rotuloDoCampo(chave)} valor={valor} />
            ))}
          </dl>
        ) : (
          <p className="text-sm text-text-muted">{t("Sem detalhes adicionais de origem.")}</p>
        )}
      </section>

      {lead.custom_fields && Object.hasOwn(lead.custom_fields, "historico") && (
        <section>
          <h4 className="mb-2 text-xs font-medium tracking-wide text-text-muted uppercase">
            {t("Histórico de atendimento")}
          </h4>
          {historico ? (
            <Historico itens={historico} fieldDefs={fieldDefs} />
          ) : (
            <p className="text-sm break-words whitespace-pre-wrap">
              {valorLegivel(lead.custom_fields.historico)}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
