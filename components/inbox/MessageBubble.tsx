"use client";

import { useLocaleDeData } from "@/hooks/i18n/useLocaleDeData";
import { format } from "date-fns";
import { useState } from "react";
import { useT } from "@/hooks/i18n/useT";
import { ArrowBendUpLeft, Check, Checks, Copy, PaperPlaneTilt, Robot, WarningOctagon } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { Message } from "@/lib/types/messaging";
import {
  MEDIA_DISCARD_REASON_CAP,
  MEDIA_DISCARD_REASON_RETENTION,
  midiaFoiDescartada,
  motivoDoDescarteDaMidia,
  nomeDoArquivoDeMidia,
} from "@/lib/messaging/media/retention";
import { CitationButton } from "@/components/ai/CitationButton";
import { MediaRenderer } from "@/components/inbox/media/MediaRenderer";
import { ContactCard } from "@/components/inbox/media/ContactCard";
import {
  extractCitations,
  isAiGeneratedMessage,
} from "@/lib/ai/citations/types";
import { copyToClipboard } from "@/lib/clipboard";
import { messageDomId } from "@/lib/inbox/message-dom";
import { toast } from "sonner";

interface Props {
  message: Message;
  debugCitations?: boolean;
  /** Escolher esta mensagem para responder "em cima" dela. */
  onResponder?: (m: Message) => void;
  onEncaminhar?: (m: Message) => void;
  selectionMode?: boolean;
  selected?: boolean;
  onToggleSelection?: (m: Message) => void;
  /** A mensagem citada por ESTA, quando houver — desenha o fio. */
  citada?: Message | null;
  /**
   * QUEM está lendo a conversa. É o que separa "Você" de "Atendente": a coluna
   * `sent_via='user'` só diz *"um humano digitou no CRM"*, nunca QUAL humano.
   *
   * Sem este id, uma organização com dois atendentes mostrava "Você" nas
   * mensagens do colega — cada um lia o atendimento do outro como se fosse o
   * seu. Por isso a ausência do id NÃO cai em "Você": quem não sabe quem está
   * lendo (a leitura do super-admin em `AdminThread`, por exemplo) rotula
   * "Atendente", que é verdadeiro para todo mundo.
   */
  viewerUserId?: string | null;
  highlighted?: boolean;
  onGoToMessage?: (messageId: string) => Promise<void> | void;
}

export function isForwardableMessage(message: Message): boolean {
  if (message.revoked_at || message.status === "failed") return false;
  if (message.type === "internal_note" || message.metadata?.internal_note === true) return false;
  if (message.type === "system" || message.metadata?.system_event === true) return false;
  return ["text", "image", "video", "document", "audio"].includes(message.type);
}

function AckIndicator({ status, t }: { status: string; t: (texto: string) => string }) {
  if (status === "read") {
    return <Checks size={12} weight="bold" className="text-blue-400" aria-label={t("Lida")} />;
  }
  if (status === "delivered") {
    return <Checks size={12} weight="bold" className="text-current/70" aria-label={t("Entregue")} />;
  }
  if (status === "sent") {
    return <Check size={12} weight="bold" className="text-current/70" aria-label={t("Enviada")} />;
  }
  return null;
}

export function MessageBubble({
  message,
  debugCitations,
  onResponder,
  onEncaminhar,
  selectionMode = false,
  selected = false,
  onToggleSelection,
  citada,
  viewerUserId,
  highlighted = false,
  onGoToMessage,
}: Props) {
  const localeDaData = useLocaleDeData();
  const t = useT();
  const isOutbound = message.direction === "outbound";
  const time = format(new Date(message.sent_at), "HH:mm", { locale: localeDaData });
  const isFailed = message.status === "failed";
  const mediaDiscarded = midiaFoiDescartada(message.metadata);
  const mediaDiscardReason = motivoDoDescarteDaMidia(message.metadata);
  const hasMedia = !mediaDiscarded && Boolean(message.media_url || message.media_storage_path);
  const mediaFilename = nomeDoArquivoDeMidia(message.metadata);
  const isContact = message.type === "contact";
  // Figurinha sem caption: sem moldura de bolha (padrão WhatsApp).
  const isBareSticker = hasMedia && message.type === "sticker" && !message.body;
  // Apagada pelo autor ("apagar para todos"). A linha continua no histórico —
  // sumir com ela deixaria a resposta seguinte respondendo ao nada —, mas o
  // texto não aparece: mostrá-lo seria expor justamente o que o cliente pediu
  // para tirar do ar.
  const apagada = Boolean(message.revoked_at);
  const encaminhavel = isForwardableMessage(message);
  const editada = Boolean(message.edited_at) && !apagada;
  const aiGenerated = isAiGeneratedMessage(message.metadata);
  const citations = extractCitations(message.metadata);
  const showCitationButton =
    isOutbound && aiGenerated && (debugCitations ?? false);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const copyableText = apagada ? "" : (message.body?.trim() ?? "");

  async function copyMessage(): Promise<void> {
    if (!copyableText) return;
    const copied = await copyToClipboard(copyableText);
    setCopyStatus(copied ? "copied" : "failed");
    if (copied) toast.success(t("Mensagem copiada."));
    else toast.error(t("Não foi possível copiar a mensagem."));
    window.setTimeout(() => setCopyStatus("idle"), 1_800);
  }
  // De quem saiu esta linha. `external_device` é a resposta pelo CELULAR — o
  // operador atendeu pelo WhatsApp do telefone, fora do CRM, e o ingest carimba
  // aqui. Antes isto voltava null para tudo que não fosse IA, e a bolha ficava
  // sem nome: o dono lia a conversa como se tudo tivesse sido digitado no CRM.
  // Os rótulos passam por t() no render (ver dicionario.ts para o espanhol).
  //
  // NÃO HÁ RAMO PARA `'automation'`. O CHECK do banco aceita o valor e o union
  // de `Message` o declara, mas nenhuma linha de app/, lib/ ou workers/ o
  // grava: as ações de automação chamam `sendMessageHandler` com
  // `actor.type === "webhook_source"`, e `_handler.ts` carimba `'ai'` em tudo
  // que não é `"user"`. Um ramo aqui seria controle decorativo — a tela
  // prometendo uma distinção que o motor não faz. Carimbar `'automation'` na
  // origem é decisão de produto com efeito colateral medido (o dedup de eco da
  // ingestão de canal filtra `sent_via in ('ai','user')`, e o valor novo
  // duplicaria a mensagem na conversa), então fica para uma issue própria.
  // Vigiado nas duas direções por tests/unit/rotulo-de-origem-tem-emissor.
  const senderLabel = (() => {
    if (!isOutbound) return null;
    if (message.sent_via === "ai") return "IA";
    if (message.sent_via === "external_device") return "Celular";
    if (message.sent_via === "user" || message.sent_via === "crm") {
      // "Você" exige as DUAS pontas: saber quem lê e saber quem enviou. Falta
      // qualquer uma, o rótulo cai para "Atendente" — que continua dizendo o
      // que `sent_via` de fato garante (um humano, pelo CRM) sem afirmar uma
      // identidade que o dado não sustenta.
      return viewerUserId != null && message.sent_by_user_id === viewerUserId
        ? "Você"
        : "Atendente";
    }
    return null;
  })();

  return (
    <div
      id={messageDomId(message.id)}
      className={cn(
        "group flex w-full scroll-m-20 items-center gap-1 px-4 py-1 transition-colors",
        isOutbound ? "justify-end" : "justify-start",
        highlighted && "bg-primary/10",
      )}
    >
      {selectionMode && encaminhavel && (
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelection?.(message)}
          aria-label={t("Selecionar esta mensagem")}
          className="h-4 w-4 shrink-0 accent-primary"
        />
      )}
      {/*
        RESPONDER — aparece ao passar o mouse, como no WhatsApp Web.
        Fica FORA da bolha para não disputar espaço com o texto, e do lado de
        dentro da conversa (à esquerda no que sai, à direita no que entra), que
        é onde a mão já está.

        `opacity` e não `hidden`: esconder de verdade faria o layout pular
        quando o mouse entra. Em telas de toque não há hover — por isso
        `focus-visible` também revela, e o teclado alcança.
      */}
      {onResponder && isOutbound && (
        <button
          type="button"
          onClick={() => onResponder(message)}
          aria-label={t("Responder a esta mensagem")}
          className={cn(
            "rounded-md p-1 text-muted-foreground transition-opacity hover:bg-muted",
            // VISÍVEL POR PADRÃO, e escondido só onde EXISTE hover.
            //
            // A primeira versão era `opacity-0` + `group-hover`, copiando o
            // WhatsApp Web. No celular isso deixa o botão invisível para
            // sempre: não há como passar o mouse, e `focus-visible` só chega
            // por teclado. Ou seja, a função sumia exatamente onde o dono
            // deste CRM mais atende.
            //
            // `@media (hover: hover)` pergunta pelo DISPOSITIVO, não pela
            // largura: um tablet largo com toque continua mostrando, e um
            // desktop estreito continua escondendo. Largura não é a pergunta.
            "opacity-100 [@media(hover:hover)]:opacity-0",
            "[@media(hover:hover)]:group-hover:opacity-100 focus-visible:opacity-100",
          )}
        >
          <ArrowBendUpLeft size={14} />
        </button>
      )}
      {onEncaminhar && encaminhavel && isOutbound && !selectionMode && (
        <button
          type="button"
          onClick={() => onEncaminhar(message)}
          aria-label={t("Encaminhar esta mensagem")}
          className="rounded-md p-1 text-muted-foreground opacity-100 transition-opacity hover:bg-muted [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 focus-visible:opacity-100"
        >
          <PaperPlaneTilt size={14} />
        </button>
      )}
      {copyableText && isOutbound && !selectionMode && (
        <button
          type="button"
          onClick={() => void copyMessage()}
          aria-label={t("Copiar mensagem")}
          className="rounded-md p-1 text-muted-foreground opacity-100 transition-opacity hover:bg-muted [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 focus-visible:opacity-100"
        >
          <Copy size={14} aria-hidden />
        </button>
      )}
      <div
        className={cn(
          "max-w-[75%] text-sm",
          isBareSticker
            ? "px-0 py-0"
            : cn(
                "rounded-2xl px-3 py-2 shadow-sm",
                isOutbound
                  ? "rounded-br-sm bg-primary text-primary-foreground"
                  : "rounded-bl-sm bg-muted text-foreground",
              ),
          isFailed && "border border-destructive",
        )}
      >
        {/*
          A CITAÇÃO, dentro da bolha e acima do texto — o fio.

          Mostra de quem era e um trecho. `line-clamp-2` porque serve para
          reconhecer, não para reler: a original está logo acima no histórico.
        */}
        {message.reply_to_message_id && (
          <button
            type="button"
            onClick={() => void onGoToMessage?.(message.reply_to_message_id!)}
            aria-label={t("Ir para a mensagem citada")}
            className={cn(
              "mb-1 block w-full rounded-md border-l-2 px-2 py-1 text-left text-xs",
              isOutbound
                ? "border-primary-foreground/50 bg-primary-foreground/10"
                : "border-primary bg-background/60",
            )}
          >
            <div className="font-medium opacity-80">
              {citada ? (citada.direction === "outbound" ? t("Você") : t("Cliente")) : t("Mensagem citada")}
            </div>
            {/*
              A CITADA PODE TER SIDO APAGADA — e aí o texto dela não volta aqui.

              A bolha principal já trata isto (`apagada`, acima): "mostrá-lo
              seria expor justamente o que o cliente pediu para tirar do ar". A
              citação é o mesmo texto, num segundo lugar da tela — sem esta
              linha, o "apagar para todos" do cliente sumia da bolha original e
              continuava legível dentro de cada resposta que a citou. O fio
              permanece (a citação some, não a resposta); o conteúdo, não.
            */}
            <div className={cn("line-clamp-2 opacity-70", citada?.revoked_at && "italic")}>
              {citada?.revoked_at
                ? t("Esta mensagem foi apagada")
                : citada?.body?.trim() || t("Carregar mensagem original")}
            </div>
          </button>
        )}
        {senderLabel && (
          <div className="mb-0.5 flex items-center gap-1 text-[11px] font-semibold opacity-80">
            {senderLabel === "IA" ? (
              <Robot size={10} weight="duotone" aria-hidden />
            ) : null}
            {senderLabel && t(senderLabel)}
          </div>
        )}

        {apagada ? (
          // Nem corpo nem mídia: o anexo apagado também sai. Em itálico e
          // esmaecido porque não é texto de ninguém — é o CRM narrando o que
          // aconteceu com aquele lugar da conversa.
          <p className="whitespace-pre-wrap break-words italic leading-snug opacity-60">
            {t("Esta mensagem foi apagada")}
          </p>
        ) : (
          <>
            {mediaDiscarded && (
              <p
                className={cn("italic leading-snug opacity-70", message.body && "mb-1")}
                data-testid="media-not-stored"
              >
                {t(rotuloDeMidiaNaoGuardada(message.type, mediaDiscardReason))}
                {mediaFilename ? `: ${mediaFilename}` : ""}
              </p>
            )}
            {hasMedia && (
              <div className={cn(message.body && "mb-1")}>
                <MediaRenderer message={message} />
              </div>
            )}

            {isContact && !hasMedia && (
              <div className={cn(message.body && isContact && "mb-1")}>
                <ContactCard message={message} />
              </div>
            )}

            {message.body && !isContact && (
              <p className="whitespace-pre-wrap break-words leading-snug">{message.body}</p>
            )}
          </>
        )}

        <div
          className={cn(
            "mt-1 flex items-center justify-end gap-1 text-[10px]",
            isOutbound ? "text-primary-foreground" : "text-muted-foreground",
          )}
        >
          {editada && (
            // Ao lado da hora, não no corpo: o texto mostrado JÁ é o novo, e o
            // que falta é avisar que ele mudou. Sem isso, um combinado de preço
            // ou endereço é lido como se sempre tivesse dito aquilo — e a
            // divergência só aparece quando alguém cobra o que não foi.
            <span title={t("O autor editou esta mensagem")}>{t("editada")}</span>
          )}
          {message.metadata?.forwarded === true && (
            <span className="mr-auto text-[10px] italic opacity-80">{t("Encaminhada")}</span>
          )}
          <span>{time}</span>
          {showCitationButton && (
            <CitationButton citations={citations} messageId={message.id} />
          )}
          {isOutbound && !isFailed && <AckIndicator status={message.status} t={t} />}
          {isFailed && (
            // Provider local: o painel do inbox não tem TooltipProvider ancestral e
            // este Tooltip só monta em mensagem failed — sem o provider, abrir uma
            // conversa com falha de envio derrubava o painel inteiro (error boundary).
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex items-center gap-0.5 font-semibold text-destructive">
                    <WarningOctagon size={10} weight="fill" aria-hidden /> {t("Falhou")}
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {message.error_message ? t(message.error_message) : (message.error_code ?? t("Erro desconhecido"))}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
      </div>
      {onResponder && !isOutbound && (
        <button
          type="button"
          onClick={() => onResponder(message)}
          aria-label={t("Responder a esta mensagem")}
          className={cn(
            "rounded-md p-1 text-muted-foreground transition-opacity hover:bg-muted",
            // VISÍVEL POR PADRÃO, e escondido só onde EXISTE hover.
            //
            // A primeira versão era `opacity-0` + `group-hover`, copiando o
            // WhatsApp Web. No celular isso deixa o botão invisível para
            // sempre: não há como passar o mouse, e `focus-visible` só chega
            // por teclado. Ou seja, a função sumia exatamente onde o dono
            // deste CRM mais atende.
            //
            // `@media (hover: hover)` pergunta pelo DISPOSITIVO, não pela
            // largura: um tablet largo com toque continua mostrando, e um
            // desktop estreito continua escondendo. Largura não é a pergunta.
            "opacity-100 [@media(hover:hover)]:opacity-0",
            "[@media(hover:hover)]:group-hover:opacity-100 focus-visible:opacity-100",
          )}
        >
          <ArrowBendUpLeft size={14} />
        </button>
      )}
      {onEncaminhar && encaminhavel && !isOutbound && !selectionMode && (
        <button
          type="button"
          onClick={() => onEncaminhar(message)}
          aria-label={t("Encaminhar esta mensagem")}
          className="rounded-md p-1 text-muted-foreground opacity-100 transition-opacity hover:bg-muted [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 focus-visible:opacity-100"
        >
          <PaperPlaneTilt size={14} />
        </button>
      )}
      {copyableText && !isOutbound && !selectionMode && (
        <button
          type="button"
          onClick={() => void copyMessage()}
          aria-label={t("Copiar mensagem")}
          className="rounded-md p-1 text-muted-foreground opacity-100 transition-opacity hover:bg-muted [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 focus-visible:opacity-100"
        >
          <Copy size={14} aria-hidden />
        </button>
      )}
      <span className="sr-only" role="status" aria-live="polite">
        {copyStatus === "copied"
          ? t("Mensagem copiada.")
          : copyStatus === "failed"
            ? t("Não foi possível copiar a mensagem.")
            : ""}
      </span>
    </div>
  );
}

function rotuloDeMidiaNaoGuardada(type: string, motivo: string | null): string {
  if (motivo === MEDIA_DISCARD_REASON_RETENTION) {
    return "Arquivo removido após o prazo de retenção";
  }
  if (motivo === MEDIA_DISCARD_REASON_CAP) {
    return "Arquivo não guardado porque o limite de mídia foi atingido";
  }
  const labels: Record<string, string> = {
    image: "Foto recebida, arquivo não guardado",
    audio: "Áudio recebido, arquivo não guardado",
    video: "Vídeo recebido, arquivo não guardado",
    sticker: "Figurinha recebida, arquivo não guardado",
    document: "Documento recebido, arquivo não guardado",
  };
  return labels[type] ?? "Mídia recebida, arquivo não guardado";
}
