"use client";

import { useLocaleDeData } from "@/hooks/i18n/useLocaleDeData";

import type { Locale } from "date-fns";
import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { formatDistanceToNowStrict } from "date-fns";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { copyToClipboard } from "@/lib/clipboard";
import { Copy, Trash } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";
import { gerarSnippetDaLandingPage } from "@/lib/webhooks/snippet-da-lp";
import {
  useDeleteWebhookSource,
  usePipelineStages,
  usePipelines,
  useUpdateWebhookSource,
  useWebhookSourceEvents,
  useWebhookSourceSummary,
  type WebhookSourceSummaryItem,
  type WebhookSourceRow,
} from "@/hooks/webhooks/useWebhookSources";
import { useAssignableMembers } from "@/hooks/inbox/useAssignableMembers";
import { useT } from "@/hooks/i18n/useT";

interface Props {
  source: WebhookSourceRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdated: (source: WebhookSourceRow) => void;
}

function publicUrl(pathToken: string): string {
  // window.location.origin > env: NEXT_PUBLIC_APP_URL é inlined no build e num
  // Docker self-host fica congelada no placeholder do Dockerfile — a origem da
  // página é o único valor confiável em runtime.
  const base =
    typeof window !== "undefined"
      ? window.location.origin
      : (process.env.NEXT_PUBLIC_APP_URL ?? "");
  return `${base}/api/v1/webhooks/in/${pathToken}`;
}

function escapeAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
}

function formSnippet(url: string, pagina: string, t: (texto: string) => string): string {
  return `<form action="${url}" method="POST" data-crm-lead>
  <input name="nome" placeholder="${t("Seu nome")}" required />
  <input name="telefone" placeholder="${t("Seu WhatsApp")}" required />
  <input name="email" type="email" placeholder="${t("Seu e-mail")}" />
  <input name="pagina" type="hidden" value="${escapeAttribute(pagina)}" />
  <button type="submit">${t("Quero receber contato")}</button>
</form>`;
}

function curlSnippet(url: string, pagina: string): string {
  const corpo = JSON.stringify({ nome: "...", telefone: "...", pagina }).replaceAll(
    "'",
    "'\\''",
  );
  return `curl -X POST ${url} \\\n  -H 'Content-Type: application/json' \\\n  -d '${corpo}'`;
}

async function copy(text: string, label: string, t: (texto: string) => string): Promise<void> {
  const ok = await copyToClipboard(text);
  if (ok) toast.success(label);
  else toast.error(t("Não foi possível copiar — selecione e copie manualmente."));
}

function relativeReceivedAt(iso: string, locale: Locale): string {
  return formatDistanceToNowStrict(new Date(iso), { addSuffix: true, locale: locale });
}

function LinhasDoResumo({
  titulo,
  itens,
  t,
}: {
  titulo: string;
  itens: WebhookSourceSummaryItem[];
  t: (texto: string) => string;
}) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{titulo}</p>
      {itens.length === 0 ? (
        <p className="text-sm text-muted-foreground">0</p>
      ) : (
        <ul className="space-y-1">
          {itens.slice(0, 5).map((item) => (
            <li
              key={item.valor === null ? "sem-marcacao" : `valor:${item.valor}`}
              className="flex justify-between gap-3 text-sm"
            >
              <span className="truncate">{item.valor ?? t("sem marcação")}</span>
              <span className="font-medium tabular-nums">{item.total}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function SourceDetail({ source, open, onOpenChange, onUpdated }: Props) {
  const localeDaData = useLocaleDeData();
  const t = useT();
  const update = useUpdateWebhookSource();
  const del = useDeleteWebhookSource();
  const { data: eventsRes, refetch: refetchEvents } = useWebhookSourceEvents(
    open ? source.id : null,
  );
  const { data: summaryRes, refetch: refetchSummary } = useWebhookSourceSummary(
    open ? source.id : null,
  );
  const { data: pipelinesRes } = usePipelines();
  const { data: stagesRes } = usePipelineStages(source.default_pipeline_id);
  const { data: members = [] } = useAssignableMembers(open);
  const [testing, setTesting] = React.useState(false);
  const [testLeadId, setTestLeadId] = React.useState<string | null>(null);

  const url = publicUrl(source.path_token);
  const snippetDaLandingPage = gerarSnippetDaLandingPage(url, source.name);
  const events = eventsRes?.data ?? [];
  const summary = summaryRes?.data;
  const pipeline = pipelinesRes?.data.find((item) => item.id === source.default_pipeline_id);
  const stage = stagesRes?.data?.stages.find((item) => item.id === source.default_stage_id);
  const owner = members.find((item) => item.user_id === source.default_owner_user_id);

  const sendTestLead = async () => {
    setTesting(true);
    setTestLeadId(null);
    try {
      // URL relativa de propósito: o teste bate no host que está servindo a
      // página, mesmo que NEXT_PUBLIC_APP_URL (usada na URL exibida p/ forms
      // externos) esteja desalinhada num self-host atrás de proxy.
      const res = await fetch(`/api/v1/webhooks/in/${source.path_token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nome: "Lead de Teste",
          telefone: "11999990000",
          pagina: source.name,
          utm_source: "teste",
          utm_campaign: "teste-da-integracao",
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        toast.error(
          t(
            body?.error?.message ??
              "Não funcionou. Confira se a fonte está ativa e se o funil/estágio ainda existem.",
          ),
        );
        return;
      }
      const body = (await res.json()) as { data?: { lead_id?: string } };
      toast.success(t("Funcionou! Um lead de teste entrou no seu funil."));
      setTestLeadId(body.data?.lead_id ?? null);
      void refetchEvents();
      void refetchSummary();
    } catch {
      toast.error(t("Não conseguimos falar com o endereço. Confira sua internet e tente de novo."));
    } finally {
      setTesting(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <div className="flex items-center gap-2">
            <SheetTitle>{source.name}</SheetTitle>
            <Badge variant={source.is_active ? "success" : "neutral"}>
              {source.is_active ? t("Ativa") : t("Pausada")}
            </Badge>
          </div>
          <SheetDescription>
            {t("Cada envio para o endereço abaixo vira um lead no seu funil, automaticamente.")}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          <section className="space-y-3">
            <div className="space-y-1">
              <h3 className="text-base font-semibold text-text">{t("Qual é a sua situação?")}</h3>
              <p className="text-sm text-muted-foreground">
                {t(
                  "Escolha o caso que combina com o seu site. Vamos mostrar somente o que você precisa usar.",
                )}
              </p>
            </div>

            <Tabs defaultValue="formulario-existente" className="space-y-3">
              <TabsList
                aria-label={t("Qual é a sua situação?")}
                className="grid h-auto w-full grid-cols-1 gap-2 overflow-visible bg-transparent p-0"
              >
                <TabsTrigger
                  value="formulario-existente"
                  className="h-auto min-w-0 flex-col items-start whitespace-normal border border-border bg-background p-3 text-left shadow-none data-[state=active]:border-accent data-[state=active]:bg-accent/10"
                >
                  <span className="font-semibold text-text">{t("Meu formulário já funciona")}</span>
                  <span className="mt-1 text-xs font-normal text-muted-foreground">
                    {t("Quero que os contatos também cheguem no CRM.")}
                  </span>
                </TabsTrigger>
                <TabsTrigger
                  value="formulario-pronto"
                  className="h-auto min-w-0 flex-col items-start whitespace-normal border border-border bg-background p-3 text-left shadow-none data-[state=active]:border-accent data-[state=active]:bg-accent/10"
                >
                  <span className="font-semibold text-text">{t("Ainda não tenho formulário")}</span>
                  <span className="mt-1 text-xs font-normal text-muted-foreground">
                    {t("Quero um formulário pronto para colocar no site.")}
                  </span>
                </TabsTrigger>
                <TabsTrigger
                  value="outra-ferramenta"
                  className="h-auto min-w-0 flex-col items-start whitespace-normal border border-border bg-background p-3 text-left shadow-none data-[state=active]:border-accent data-[state=active]:bg-accent/10"
                >
                  <span className="font-semibold text-text">{t("Uso outra ferramenta")}</span>
                  <span className="mt-1 text-xs font-normal text-muted-foreground">
                    {t("Elementor, RD Station, Typeform, Zapier ou n8n.")}
                  </span>
                </TabsTrigger>
              </TabsList>

              <TabsContent
                value="formulario-existente"
                className="space-y-3 rounded-sm border border-border p-4"
              >
                <div className="space-y-2 text-sm text-muted-foreground">
                  <p className="font-medium text-text">
                    {t("Use este caminho se a página já recebe contatos normalmente.")}
                  </p>
                  <ol className="list-decimal space-y-1 pl-5">
                    <li>
                      {t(
                        "Peça a quem cuida do site para adicionar data-crm-lead na primeira linha do formulário.",
                      )}
                    </li>
                    <li>{t("Depois, cole o script abaixo logo após o formulário.")}</li>
                    <li>{t("Publique a página e faça um envio de teste.")}</li>
                  </ol>
                </div>
                <Textarea
                  aria-label={t("Script para landing page")}
                  readOnly
                  rows={10}
                  value={snippetDaLandingPage}
                  className="font-mono text-xs"
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() =>
                    copy(snippetDaLandingPage, t("Script da landing page copiado."), t)
                  }
                >
                  <Copy /> {t("Copiar script da landing page")}
                </Button>
              </TabsContent>

              <TabsContent
                value="formulario-pronto"
                className="space-y-3 rounded-sm border border-border p-4"
              >
                <div className="space-y-2 text-sm text-muted-foreground">
                  <p className="font-medium text-text">
                    {t("Use este caminho se você ainda precisa colocar um formulário na página.")}
                  </p>
                  <ol className="list-decimal space-y-1 pl-5">
                    <li>
                      {t(
                        "Copie o formulário abaixo e cole no lugar da página em que ele deve aparecer.",
                      )}
                    </li>
                    <li>{t("Depois, publique a página e envie um contato de teste.")}</li>
                  </ol>
                </div>
                <Textarea
                  aria-label={t("Formulário pronto para colar no seu site")}
                  readOnly
                  rows={6}
                  value={formSnippet(url, source.name, t)}
                  className="font-mono text-xs"
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() =>
                    copy(formSnippet(url, source.name, t), t("Formulário copiado."), t)
                  }
                >
                  <Copy /> {t("Copiar formulário")}
                </Button>
              </TabsContent>

              <TabsContent
                value="outra-ferramenta"
                className="space-y-3 rounded-sm border border-border p-4"
              >
                <div className="space-y-2 text-sm text-muted-foreground">
                  <p className="font-medium text-text">
                    {t("Use este caminho com Elementor, RD Station, Typeform, Zapier ou n8n.")}
                  </p>
                  <ol className="list-decimal space-y-1 pl-5">
                    <li>
                      {t(
                        "Na ferramenta, abra a configuração que envia as respostas para outro sistema.",
                      )}
                    </li>
                    <li>
                      {t(
                        'Cole o endereço abaixo no campo de destino. No Elementor, o campo "Action" é a opção que diz para onde o formulário envia os dados.',
                      )}
                    </li>
                    <li>{t("Salve a configuração e faça um envio de teste.")}</li>
                  </ol>
                </div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 truncate rounded-sm border border-border bg-muted px-3 py-2 text-xs">
                    {url}
                  </code>
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon"
                    aria-label={t("Copiar endereço")}
                    onClick={() => copy(url, t("Endereço copiado."), t)}
                  >
                    <Copy />
                  </Button>
                </div>
              </TabsContent>
            </Tabs>
          </section>

          <details className="rounded-sm border border-border p-3">
            <summary className="cursor-pointer list-none text-sm font-medium text-text">
              {t("Para desenvolvedores")}
            </summary>
            <pre className="mt-3 overflow-x-auto rounded-sm bg-muted p-3 text-xs">
              <code>{curlSnippet(url, source.name)}</code>
            </pre>
          </details>

          <section className="space-y-3">
            <Button type="button" onClick={sendTestLead} disabled={testing}>
              {testing ? t("Enviando…") : t("Testar agora")}
            </Button>
            {testLeadId ? (
              <div className="rounded-sm border border-success/40 bg-success/10 p-3 text-sm">
                <p className="font-medium text-text">{t("Teste concluído.")}</p>
                <p className="text-muted-foreground">
                  {t("Destino do teste")}: {pipeline?.name ?? t("funil selecionado")} /{" "}
                  {stage?.name ?? t("etapa selecionada")}. {t("Responsável")}:{" "}
                  {owner?.full_name ?? t("a pessoa escolhida")}.
                </p>
                <Link
                  href={`/app/pipelines/${source.default_pipeline_id}?lead=${testLeadId}`}
                  className="mt-1 inline-block text-accent underline underline-offset-4"
                >
                  {t("Abrir o lead de teste")}
                </Link>
              </div>
            ) : null}
          </section>

          <section className="space-y-3 rounded-sm border border-border p-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium text-text">{t("Origens dos últimos 30 dias")}</p>
              <span className="text-sm font-semibold tabular-nums">{summary?.total ?? 0}</span>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <LinhasDoResumo titulo={t("Origem")} itens={summary?.por_utm_source ?? []} t={t} />
              <LinhasDoResumo titulo={t("Campanha")} itens={summary?.por_utm_campaign ?? []} t={t} />
              <LinhasDoResumo titulo={t("Página")} itens={summary?.por_pagina ?? []} t={t} />
            </div>
            <p className="text-xs text-muted-foreground">
              {t("Sem marcação UTM")}:{" "}
              <strong className="text-text">{summary?.sem_marcacao ?? 0}</strong>
            </p>
          </section>

          <section className="space-y-2">
            <p className="text-sm font-medium text-text">{t("Últimos recebimentos")}</p>
            {events.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("Ainda não chegou nada por aqui.")}</p>
            ) : (
              <ul className="space-y-1">
                {events.map((ev) => (
                  <li key={ev.id} className="flex items-center gap-2 text-sm">
                    <span
                      className={cn(
                        "h-2 w-2 shrink-0 rounded-full",
                        ev.valid_signature === false ? "bg-error" : "bg-success",
                      )}
                    />
                    <span className="text-muted-foreground">{relativeReceivedAt(ev.created_at, localeDaData)}</span>
                    {ev.valid_signature === false ? (
                      <span className="text-xs text-error">{t("assinatura inválida")}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="flex items-center justify-between rounded-sm border border-border p-3">
            <div>
              <p className="text-sm font-medium text-text">{t("Fonte ativa")}</p>
              <p className="text-xs text-muted-foreground">
                {t("Pausada, ela para de aceitar novos envios.")}
              </p>
            </div>
            <Switch
              checked={source.is_active}
              disabled={update.isPending}
              onCheckedChange={(checked) =>
                update.mutate(
                  { id: source.id, is_active: checked },
                  {
                    onSuccess: (res) => {
                      onUpdated(res.data);
                      toast.success(checked ? t("Fonte ativada.") : t("Fonte pausada."));
                    },
                  },
                )
              }
            />
          </section>

          <section className="flex items-start justify-between gap-4 rounded-sm border border-border p-3">
            <div className="space-y-1">
              <p className="text-sm font-medium text-text">
                {t("Esta origem pode repetir o mesmo envio")}
              </p>
              <p className="text-xs text-muted-foreground">
                {t(
                  "Ative se a ferramenta às vezes manda a mesma pessoa mais de uma vez. Os envios próximos ficam no mesmo card.",
                )}
              </p>
            </div>
            <Switch
              aria-label={t("Esta origem pode repetir o mesmo envio")}
              checked={source.merge_repeated_submissions}
              disabled={update.isPending}
              onCheckedChange={(checked) =>
                update.mutate(
                  { id: source.id, merge_repeated_submissions: checked },
                  {
                    onSuccess: (res) => {
                      onUpdated(res.data);
                      toast.success(
                        checked
                          ? t("Envios repetidos serão mantidos no mesmo card.")
                          : t("Cada novo envio voltará a criar um card."),
                      );
                    },
                  },
                )
              }
            />
          </section>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" variant="destructive">
                <Trash /> {t("Excluir fonte")}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("Excluir esta fonte?")}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t(
                    "O endereço para de funcionar imediatamente. Leads já recebidos continuam no seu funil — só a captação futura é interrompida. Essa ação não pode ser desfeita.",
                  )}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("Cancelar")}</AlertDialogCancel>
                <AlertDialogAction
                  onClick={async () => {
                    await del.mutateAsync(source.id);
                    toast.success(t("Fonte excluída."));
                    onOpenChange(false);
                  }}
                >
                  {t("Excluir")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </SheetContent>
    </Sheet>
  );
}
