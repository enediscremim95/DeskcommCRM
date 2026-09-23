"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { useT } from "@/hooks/i18n/useT";
import { copyToClipboard } from "@/lib/clipboard";
import {
  apresentacaoDoValor,
  historicoEstruturado,
  linhasDaNota,
  rotuloDoCampo,
  valorLegivel,
} from "@/lib/leads/dados-completos";
import { origemComUtms } from "@/lib/leads/utm-da-url";
import type { CustomFieldDef } from "@/lib/schemas/settings";
import type { Lead } from "@/lib/types/leads";
import { CaretRight, Check, Copy } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";

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

function estaVazio(valor: unknown): boolean {
  const texto = valorLegivel(valor);
  return texto === "-" || texto === "";
}

/** Botão discreto que copia o valor inteiro — para o que não cabe na linha. */
function BotaoCopiar({ texto }: { texto: string }) {
  const t = useT();
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    if (!copiado) return;
    const timer = window.setTimeout(() => setCopiado(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copiado]);

  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      className="h-6 w-6 shrink-0 text-text-muted hover:text-text"
      aria-label={t("Copiar")}
      title={copiado ? t("Copiado!") : t("Copiar")}
      onClick={async () => {
        if (await copyToClipboard(texto)) setCopiado(true);
      }}
    >
      {copiado ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />}
    </Button>
  );
}

/**
 * Um valor de texto, com a quebra decidida pelo que ele é. Prosa quebra em
 * palavra; e-mail, endereço e código ficam numa linha só, com o valor inteiro
 * no tooltip e num botão de copiar — em painel estreito é isso ou partir
 * "ferrernelson33@yahoo.com" em quatro linhas.
 */
function ValorDeTexto({ texto, nowrap }: { texto: string; nowrap?: boolean }) {
  const apresentacao = apresentacaoDoValor(texto);

  if (nowrap) {
    return <span className="whitespace-nowrap tabular-nums">{texto}</span>;
  }

  if (apresentacao === "email" || apresentacao === "url") {
    const href = apresentacao === "email" ? `mailto:${texto.trim()}` : texto.trim();
    return (
      <span className="flex min-w-0 items-center gap-1">
        <a
          className="min-w-0 truncate hover:underline"
          href={href}
          title={texto}
          target={apresentacao === "url" ? "_blank" : undefined}
          rel={apresentacao === "url" ? "noopener noreferrer" : undefined}
        >
          {texto}
        </a>
        <BotaoCopiar texto={texto.trim()} />
      </span>
    );
  }

  if (apresentacao === "codigo") {
    return (
      <span className="flex min-w-0 items-center gap-1">
        <span className="min-w-0 truncate font-mono text-xs" title={texto}>
          {texto}
        </span>
        <BotaoCopiar texto={texto.trim()} />
      </span>
    );
  }

  const linhas = linhasDaNota(texto);
  if (linhas) {
    return (
      <span className="grid gap-0.5">
        {linhas.map((linha, indice) => (
          <span key={indice} className="min-w-0 break-words">
            {linha.rotulo ? <span className="text-text-muted">{linha.rotulo}: </span> : null}
            {linha.valor}
          </span>
        ))}
      </span>
    );
  }

  return <span className="break-words whitespace-pre-wrap">{texto}</span>;
}

interface CampoProps {
  rotulo: string;
  valor: unknown;
  /** Data e hora não quebram no meio: "20/09/2026, 17:20" numa linha só. */
  nowrap?: boolean;
}

/**
 * Uma linha rótulo → valor, como a ficha do Kommo. A largura que manda é a do
 * PAINEL (container query), não a da janela: no painel estreito o rótulo fica
 * em cima e o valor embaixo, inteiro; a partir de 28rem os dois dividem a
 * linha. Rótulo nunca é cortado com reticências.
 */
function Campo({ rotulo, valor, nowrap }: CampoProps) {
  const texto = valorLegivel(valor);
  const objeto = typeof valor === "object" && valor !== null && !Array.isArray(valor);

  return (
    <div className="grid min-w-0 gap-x-3 gap-y-0.5 border-b border-border/60 py-2 @md:grid-cols-[9rem_minmax(0,1fr)] @md:items-baseline">
      <dt className="min-w-0 text-[11px] leading-4 break-words text-text-muted @md:text-xs @md:leading-5">
        {rotulo}
      </dt>
      <dd className="min-w-0 text-[13px] leading-5 text-text">
        {objeto ? (
          <span className="block font-mono text-xs break-all whitespace-pre-wrap">{texto}</span>
        ) : (
          <ValorDeTexto texto={texto} nowrap={nowrap} />
        )}
      </dd>
    </div>
  );
}

function Titulo({ children }: { children: string }) {
  return (
    <h4 className="mb-1 text-[11px] font-semibold tracking-[0.08em] text-text-muted uppercase">
      {children}
    </h4>
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
                <div
                  key={chave}
                  className="grid min-w-0 gap-x-2 @sm:grid-cols-[minmax(6rem,0.35fr)_1fr]"
                >
                  <dt className="text-xs text-text-muted">{rotuloDoCampo(chave, fieldDefs)}</dt>
                  <dd className="min-w-0 break-words whitespace-pre-wrap">{valorLegivel(valor)}</dd>
                </div>
              ))}
            </dl>
          </li>
        );
      })}
    </ol>
  );
}

/** Campos declarados no funil vêm primeiro, na ordem do funil; o resto depois. */
function ordenarCampos(campos: Array<[string, unknown]>, fieldDefs: CustomFieldDef[]) {
  const posicao = new Map(fieldDefs.map((campo, indice) => [campo.key, indice]));
  return [...campos].sort(([a], [b]) => {
    const pa = posicao.get(a) ?? Number.MAX_SAFE_INTEGER;
    const pb = posicao.get(b) ?? Number.MAX_SAFE_INTEGER;
    return pa - pb;
  });
}

/**
 * Uma apresentação única para a ficha do contato e o dossiê do Kanban.
 * Campos declarados ganham o rótulo do funil; os demais continuam visíveis com
 * rótulo derivado da chave. Assim importação, webhook e WhatsApp não dependem
 * de configuração posterior para o dado aparecer.
 *
 * Campo em branco não aparece: numa ficha lida dezenas de vezes por dia, o
 * "-" repetido só empurra para baixo o que importa. O que tem valor está aqui;
 * o que não tem, o formulário de edição mostra.
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
  const campos = ordenarCampos(
    Object.entries(lead.custom_fields ?? {}).filter(
      ([chave, valor]) => chave !== "historico" && !estaVazio(valor),
    ),
    fieldDefs,
  );
  // A campanha costuma chegar grudada na URL da página ("?utm_campaign=..."),
  // então ela também vira linha com nome, e não um endereço cortado na tela.
  const origem = origemComUtms(
    lead.source_metadata as Record<string, unknown> | null,
    Object.values(lead.custom_fields ?? {}),
  ).filter(([, valor]) => !estaVazio(valor));

  const negocio: CampoProps[] = [
    { rotulo: t("Título"), valor: lead.title },
    { rotulo: t("Funil"), valor: pipelineName ?? t("Não informado") },
    { rotulo: t("Etapa"), valor: stageName ?? t("Não informado") },
    { rotulo: t("Valor"), valor: dinheiroLegivel(lead.value_cents, lead.currency, locale) },
    { rotulo: t("Origem"), valor: lead.source },
    { rotulo: t("Responsável"), valor: lead.owner_agent?.name ?? null },
    { rotulo: t("Tags"), valor: lead.tags },
    { rotulo: t("Descrição"), valor: lead.description },
    {
      rotulo: t("Previsão de fechamento"),
      valor: dataLegivel(lead.expected_close_date, locale),
      nowrap: true,
    },
    { rotulo: t("Fechado em"), valor: dataLegivel(lead.closed_at, locale), nowrap: true },
    { rotulo: t("Motivo da perda"), valor: lead.lost_reason },
  ].filter((campo) => !estaVazio(campo.valor));

  const sistema: CampoProps[] = [
    { rotulo: t("Identificador externo"), valor: lead.external_id },
    { rotulo: t("Atribuído em"), valor: dataLegivel(lead.assigned_at, locale), nowrap: true },
    { rotulo: t("Criado em"), valor: dataLegivel(lead.created_at, locale), nowrap: true },
    { rotulo: t("Atualizado em"), valor: dataLegivel(lead.updated_at, locale), nowrap: true },
    {
      rotulo: t("Última atividade"),
      valor: dataLegivel(lead.last_activity_at, locale),
      nowrap: true,
    },
  ].filter((campo) => !estaVazio(campo.valor));

  return (
    <div className="@container space-y-5" data-testid={`dados-completos-lead-${lead.id}`}>
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

      <section>
        <Titulo>{t("Negócio")}</Titulo>
        <dl className="grid grid-cols-1 gap-x-6 @3xl:grid-cols-2">
          {negocio.map((campo) => (
            <Campo key={campo.rotulo} {...campo} />
          ))}
        </dl>
      </section>

      <section>
        <Titulo>{t("Dados informados")}</Titulo>
        {campos.length > 0 ? (
          <dl className="grid grid-cols-1 gap-x-6 @3xl:grid-cols-2">
            {campos.map(([chave, valor]) => (
              <Campo key={chave} rotulo={rotuloDoCampo(chave, fieldDefs)} valor={valor} />
            ))}
          </dl>
        ) : (
          <p className="text-sm text-text-muted">{t("Nenhum campo adicional informado.")}</p>
        )}
      </section>

      <section>
        <Titulo>{t("Origem, campanha e anúncio")}</Titulo>
        {origem.length > 0 ? (
          <dl className="grid grid-cols-1 gap-x-6 @3xl:grid-cols-2">
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
          <Titulo>{t("Histórico de atendimento")}</Titulo>
          {historico ? (
            <Historico itens={historico} fieldDefs={fieldDefs} />
          ) : (
            <p className="text-sm break-words whitespace-pre-wrap">
              {valorLegivel(lead.custom_fields.historico)}
            </p>
          )}
        </section>
      )}

      {sistema.length > 0 ? (
        <details className="group">
          <summary
            className={cn(
              "flex cursor-pointer list-none items-center gap-1 text-[11px] font-semibold tracking-[0.08em] text-text-subtle uppercase select-none",
              "hover:text-text-muted [&::-webkit-details-marker]:hidden",
            )}
          >
            <CaretRight
              size={12}
              aria-hidden
              className="transition-transform group-open:rotate-90"
            />
            {t("Sistema")}
          </summary>
          <dl className="mt-1 grid grid-cols-1 gap-x-6 @3xl:grid-cols-2">
            {sistema.map((campo) => (
              <Campo key={campo.rotulo} {...campo} />
            ))}
          </dl>
        </details>
      ) : null}
    </div>
  );
}
