"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { BotaoCopiar, dinheiroLegivel } from "@/components/leads/DadosCompletosDoLead";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { useT } from "@/hooks/i18n/useT";
import type {
  GrupoDeNegociosDuplicados,
  JuncaoDeNegociosRecente,
  NegocioDuplicado,
  ResultadoJuncaoDeNegocios,
} from "@/lib/leads/negocios-duplicados";

interface ApiData<T> {
  data: T;
}

interface ApiFailure {
  error?: { message?: string };
}

interface Selecao {
  survivor: NegocioDuplicado;
  absorbed: NegocioDuplicado;
}

type Tradutor = ReturnType<typeof useT>;

async function respostaJson<T>(
  response: Response,
  t: Tradutor,
  mensagemPadrao = t("Não foi possível concluir."),
): Promise<T> {
  const body = (await response.json()) as ApiData<T> & ApiFailure;
  if (!response.ok) {
    throw new Error(body.error?.message ? t(body.error.message) : mensagemPadrao);
  }
  return body.data;
}

function texto(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function primeiroTexto(meta: Record<string, unknown>, chaves: string[]): string | null {
  for (const chave of chaves) {
    const valor = texto(meta[chave]);
    if (valor) return valor;
  }
  return null;
}

function chaveNormalizada(chave: string): string {
  return chave
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^a-z0-9]/g, "");
}

function valorTecnico(valor: unknown): string | null {
  if (valor == null || valor === "") return null;
  if (typeof valor === "string") return valor.trim() || null;
  return JSON.stringify(valor) ?? String(valor);
}

function ehDetalheTecnico(chave: string, valor: string): boolean {
  const normalizada = chaveNormalizada(chave);
  return (
    /(?:url|link|uuid|fbclid|gclid|clid|tracking|token|pixel)/.test(normalizada) ||
    /(?:^|_)(?:id|ids)$/.test(chave.toLocaleLowerCase("pt-BR")) ||
    /^https?:\/\//i.test(valor) ||
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(valor)
  );
}

function detalhesTecnicos(
  negocio: NegocioDuplicado,
  t: Tradutor,
): Array<[rotulo: string, valor: string]> {
  const encontrados: Array<[string, string]> = [[t("ID do negócio"), negocio.id]];
  for (const [chave, bruto] of [
    ...Object.entries(negocio.source_metadata ?? {}),
    ...Object.entries(negocio.custom_fields ?? {}),
  ]) {
    const valor = valorTecnico(bruto);
    if (valor && ehDetalheTecnico(chave, valor)) encontrados.push([chave, valor]);
  }
  const vistos = new Set<string>();
  return encontrados.filter(([rotulo, valor]) => {
    const assinatura = `${rotulo}:${valor}`;
    if (vistos.has(assinatura)) return false;
    vistos.add(assinatura);
    return true;
  });
}

function linhasDeContexto(
  negocio: NegocioDuplicado,
  t: Tradutor,
  locale: string,
): Array<[string, string]> {
  const meta = negocio.source_metadata ?? {};
  const linhas: Array<[string, string | null]> = [
    [
      t("Origem"),
      primeiroTexto(meta, ["page_name", "landing_page_name", "form_name", "origin", "source"]) ??
        negocio.source,
    ],
    [t("Campanha"), primeiroTexto(meta, ["campaign_name", "utm_campaign", "campaign"])],
    [t("Conjunto"), primeiroTexto(meta, ["adset_name", "utm_content"])],
    [
      t("Valor"),
      negocio.value_cents === null ? null : dinheiroLegivel(negocio.value_cents, "BRL", locale),
    ],
  ];
  return linhas.filter((item): item is [string, string] => Boolean(item[1]));
}

function Cartao({ negocio, vazio }: { negocio: NegocioDuplicado; vazio?: boolean }) {
  const t = useT();
  const locale = useTagDeIdioma();
  const contexto = linhasDeContexto(negocio, t, locale);
  const tecnicos = detalhesTecnicos(negocio, t);
  const criadoEm = new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
    .format(new Date(negocio.created_at))
    .replace(",", "");
  return (
    <div
      className="flex h-full min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-card p-4"
      data-testid={`candidato-${negocio.id}`}
    >
      <div className="mb-4 flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="line-clamp-2 font-medium text-foreground" title={negocio.title}>
            {negocio.title}
          </p>
          <p className="mt-1 truncate text-xs text-muted-foreground" title={negocio.pipeline_name}>
            {negocio.pipeline_name}
          </p>
        </div>
        <Badge variant={vazio ? "neutral" : "success"} className="shrink-0">
          {vazio ? t("Sem contexto") : t("Fica")}
        </Badge>
      </div>
      <div className="min-w-0 flex-1" data-testid="resumo-do-candidato">
        <p className="mb-3 text-xs text-muted-foreground">
          <span>{t("Criado em")}: </span>
          <time dateTime={negocio.created_at}>{criadoEm}</time>
        </p>
        {contexto.length > 0 ? (
          <dl className="space-y-2 text-sm">
            {contexto.map(([rotulo, valor]) => (
              <div key={`${rotulo}:${valor}`} className="grid min-w-0 gap-0.5">
                <dt className="text-xs text-muted-foreground">{rotulo}</dt>
                <dd className="min-w-0 truncate text-foreground" title={valor}>
                  {valor}
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">{t("Sem dados adicionais para decidir.")}</p>
        )}
      </div>

      {tecnicos.length > 0 ? (
        <details className="mt-4 border-t border-border pt-3" data-testid="detalhes-tecnicos">
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
            {t("Detalhes técnicos")}
          </summary>
          <dl className="mt-3 space-y-3 text-xs">
            {tecnicos.map(([rotulo, valor]) => (
              <div key={`${rotulo}:${valor}`} className="min-w-0">
                <dt className="text-muted-foreground">{rotulo}</dt>
                <dd className="mt-0.5 flex min-w-0 items-start gap-1 text-foreground">
                  <span className="min-w-0 flex-1 font-mono break-all" title={valor}>
                    {valor}
                  </span>
                  <BotaoCopiar texto={valor} />
                </dd>
              </div>
            ))}
          </dl>
        </details>
      ) : null}
    </div>
  );
}

export function NegociosDuplicadosClient() {
  const t = useT();
  const [grupos, setGrupos] = useState<GrupoDeNegociosDuplicados[]>([]);
  const [recentes, setRecentes] = useState<JuncaoDeNegociosRecente[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [selecao, setSelecao] = useState<Selecao | null>(null);
  const [desfazer, setDesfazer] = useState<JuncaoDeNegociosRecente | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const [candidatos, juncoes] = await Promise.all([
        fetch("/api/v1/leads/duplicates", { cache: "no-store" }).then((r) =>
          respostaJson<GrupoDeNegociosDuplicados[]>(r, t, t("Não foi possível carregar.")),
        ),
        fetch("/api/v1/leads/merges/recent", { cache: "no-store" }).then((r) =>
          respostaJson<JuncaoDeNegociosRecente[]>(r, t, t("Não foi possível carregar.")),
        ),
      ]);
      setGrupos(candidatos);
      setRecentes(juncoes);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("Não foi possível carregar."));
    } finally {
      setCarregando(false);
    }
  }, [t]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function executarJuncao() {
    if (!selecao) return;
    const atual = selecao;
    setSalvando(true);
    try {
      const resultado = await fetch("/api/v1/leads/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          survivor_lead_id: atual.survivor.id,
          absorbed_lead_id: atual.absorbed.id,
        }),
      }).then((r) =>
        respostaJson<ResultadoJuncaoDeNegocios>(r, t, t("Não foi possível juntar.")),
      );
      setSelecao(null);
      toast.success(t("Negócios juntados."), {
        action: {
          label: t("Desfazer"),
          onClick: () => {
            const item: JuncaoDeNegociosRecente = {
              id: resultado.log_id,
              survivor_lead_id: resultado.survivor_lead_id,
              absorbed_lead_id: resultado.absorbed_lead_id,
              survivor_title: atual.survivor.title,
              absorbed_title: atual.absorbed.title,
              merged_at: new Date().toISOString(),
              merged_by_user_id: null,
            };
            void executarDesfazer(item);
          },
        },
      });
      await carregar();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("Não foi possível juntar."));
    } finally {
      setSalvando(false);
    }
  }

  async function executarDesfazer(item: JuncaoDeNegociosRecente) {
    setSalvando(true);
    try {
      await fetch(`/api/v1/leads/merge/${item.id}/undo`, { method: "POST" }).then((r) =>
        respostaJson<ResultadoJuncaoDeNegocios>(r, t, t("Não foi possível desfazer.")),
      );
      setDesfazer(null);
      toast.success(t("Junção desfeita."));
      await carregar();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("Não foi possível desfazer."));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-6xl space-y-8 p-4 sm:p-6 lg:p-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-foreground">{t("Negócios duplicados")}</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          {t("Compare os negócios abertos do mesmo contato e funil.")}
        </p>
        {!carregando ? (
          <p className="pt-2 text-sm font-medium text-foreground">
            {t(
              grupos.length === 1
                ? "{{count}} grupo para conferir"
                : "{{count}} grupos para conferir",
            ).replace("{{count}}", String(grupos.length))}
          </p>
        ) : null}
      </header>

      {carregando ? (
        <div className="grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-3">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : grupos.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          {t("Nenhum negócio duplicado para conferir.")}
        </div>
      ) : (
        <section className="space-y-5" aria-label={t("Negócios para conferir")}>
          {grupos.map((grupo) => (
            <article
              key={grupo.group_key}
              className="min-w-0 overflow-hidden rounded-xl border border-border bg-surface"
            >
              <div className="p-4 pb-0 sm:p-5 sm:pb-0">
                <h2 className="font-medium text-foreground">
                  {grupo.survivor.contact_name ?? t("Contato sem nome")}
                </h2>
                <p className="text-xs text-muted-foreground">
                  {grupo.classification === "todos_vazios"
                    ? t("Todos estão vazios. O mais antigo fica.")
                    : t("O negócio com origem e campanha fica. Os vazios podem ser absorvidos.")}
                </p>
              </div>
              <div
                className="grid min-w-0 gap-3 p-4 sm:p-5 md:grid-cols-2 xl:grid-cols-3"
                data-testid={`candidatos-${grupo.group_key}`}
              >
                <Cartao negocio={grupo.survivor} />
                {grupo.absorbed.map((absorvido) => (
                  <Cartao key={absorvido.id} negocio={absorvido} vazio />
                ))}
              </div>
              <footer className="flex flex-col gap-3 border-t border-border bg-muted/20 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                <p className="text-xs text-muted-foreground">
                  {t("Nada é juntado sem sua confirmação.")}
                </p>
                <div className="flex flex-wrap justify-end gap-2">
                  {grupo.absorbed.map((absorvido) => (
                    <Button
                      key={absorvido.id}
                      onClick={() => setSelecao({ survivor: grupo.survivor, absorbed: absorvido })}
                    >
                      {t("Juntar")}
                    </Button>
                  ))}
                </div>
              </footer>
            </article>
          ))}
        </section>
      )}

      <section className="space-y-3 border-t border-border pt-6">
        <div>
          <h2 className="text-lg font-medium text-foreground">{t("Junções recentes")}</h2>
          <p className="text-sm text-muted-foreground">
            {t("Você pode desfazer enquanto o histórico não tiver mudado.")}
          </p>
        </div>
        {recentes.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("Nenhuma junção recente.")}</p>
        ) : recentes.map((item) => (
          <div key={item.id} className="flex flex-col gap-3 rounded-lg border border-border p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">{item.survivor_title}</p>
              <p className="truncate text-xs text-muted-foreground">
                {t("Absorveu: {{absorbed}}").replace("{{absorbed}}", item.absorbed_title)}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => setDesfazer(item)}>
              {t("Desfazer")}
            </Button>
          </div>
        ))}
      </section>

      <AlertDialog open={Boolean(selecao)} onOpenChange={(open) => !open && setSelecao(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Juntar estes negócios?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                'O negócio "{{survivor}}" fica. O negócio "{{absorbed}}" será absorvido e sairá do funil. Você poderá desfazer depois.',
              )
                .replace("{{survivor}}", selecao?.survivor.title ?? "")
                .replace("{{absorbed}}", selecao?.absorbed.title ?? "")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={salvando}>{t("Cancelar")}</AlertDialogCancel>
            <Button onClick={() => void executarJuncao()} disabled={salvando}>
              {salvando ? t("Juntando...") : t("Juntar negócios")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={Boolean(desfazer)} onOpenChange={(open) => !open && setDesfazer(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Desfazer esta junção?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('O negócio "{{absorbed}}" voltará com os registros que foram movidos.').replace(
                "{{absorbed}}",
                desfazer?.absorbed_title ?? "",
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={salvando}>{t("Cancelar")}</AlertDialogCancel>
            <Button onClick={() => desfazer && void executarDesfazer(desfazer)} disabled={salvando}>
              {salvando ? t("Desfazendo...") : t("Desfazer")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
