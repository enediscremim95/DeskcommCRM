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
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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

function linhasDeContexto(negocio: NegocioDuplicado, t: Tradutor): Array<[string, string]> {
  const meta = negocio.source_metadata ?? {};
  const linhas: Array<[string, string | null]> = [
    [t("Origem"), texto(meta.origin) ?? texto(meta.source) ?? negocio.source],
    [t("Página"), texto(meta.page_url) ?? texto(meta.page) ?? texto(meta.url)],
    [t("Campanha"), texto(meta.utm_campaign) ?? texto(meta.campaign)],
    [t("Conjunto"), texto(meta.utm_content) ?? texto(meta.adset_name)],
  ];
  for (const [chave, valor] of Object.entries(negocio.custom_fields ?? {})) {
    if (valor == null || valor === "") continue;
    linhas.push([chave, typeof valor === "string" ? valor : JSON.stringify(valor)]);
  }
  return linhas.filter((item): item is [string, string] => Boolean(item[1]));
}

function Cartao({ negocio, vazio }: { negocio: NegocioDuplicado; vazio?: boolean }) {
  const t = useT();
  const contexto = linhasDeContexto(negocio, t);
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium text-foreground">{negocio.title}</p>
          <p className="text-xs text-muted-foreground">{negocio.pipeline_name}</p>
        </div>
        <span className={`rounded-full px-2 py-1 text-xs ${vazio ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary"}`}>
          {vazio ? t("Sem contexto") : t("Fica")}
        </span>
      </div>
      {contexto.length > 0 ? (
        <dl className="space-y-2 text-sm">
          {contexto.map(([rotulo, valor]) => (
            <div key={`${rotulo}:${valor}`} className="grid grid-cols-[88px_1fr] gap-2">
              <dt className="text-muted-foreground">{rotulo}</dt>
              <dd className="break-words text-foreground">{valor}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-sm text-muted-foreground">
          {t("Sem origem, campanha, campos, valor ou marcadores.")}
        </p>
      )}
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
      <header>
        <h1 className="text-2xl font-semibold text-foreground">{t("Negócios duplicados")}</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          {t("Confira os negócios abertos do mesmo contato e funil. Nada é juntado sem sua confirmação.")}
        </p>
      </header>

      {carregando ? (
        <div className="space-y-3"><Skeleton className="h-48 w-full" /><Skeleton className="h-48 w-full" /></div>
      ) : grupos.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          {t("Nenhum negócio duplicado para conferir.")}
        </div>
      ) : (
        <section className="space-y-5" aria-label={t("Negócios para conferir")}>
          {grupos.map((grupo) => (
            <article key={grupo.group_key} className="rounded-xl border border-border bg-surface p-4 sm:p-5">
              <div className="mb-4">
                <h2 className="font-medium text-foreground">
                  {grupo.survivor.contact_name ?? t("Contato sem nome")}
                </h2>
                <p className="text-xs text-muted-foreground">
                  {grupo.classification === "todos_vazios"
                    ? t("Todos estão vazios. O mais antigo fica.")
                    : t("O negócio com origem e campanha fica. Os vazios podem ser absorvidos.")}
                </p>
              </div>
              {grupo.absorbed.map((absorvido) => (
                <div key={absorvido.id} className="mb-4 grid grid-cols-1 gap-3 lg:grid-cols-[1fr_1fr_auto] lg:items-center">
                  <Cartao negocio={grupo.survivor} />
                  <Cartao negocio={absorvido} vazio />
                  <Button onClick={() => setSelecao({ survivor: grupo.survivor, absorbed: absorvido })}>
                    {t("Juntar")}
                  </Button>
                </div>
              ))}
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
