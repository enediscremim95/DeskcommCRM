"use client";
import { useT } from "@/hooks/i18n/useT";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
} from "react";
import { PaperPlaneTilt } from "@/lib/ui/icons";
import { Button } from "@/components/ui/button";
import { AttachMenu } from "@/components/inbox/composer/AttachMenu";
import { AttachmentPreviewDialog } from "@/components/inbox/composer/AttachmentPreviewDialog";
import { ContactPickerDialog } from "@/components/inbox/composer/ContactPickerDialog";
import {
  CatalogPickerDialog,
  type RascunhoDoCatalogo,
} from "@/components/inbox/composer/CatalogPickerDialog";
import { AudioRecorder } from "@/components/inbox/composer/AudioRecorder";
import { DraftReplyButton } from "@/components/inbox/composer/DraftReplyButton";
import { ReplyReviewPanel } from "@/components/inbox/composer/ReplyReviewPanel";
import { EmojiButton } from "@/components/inbox/composer/EmojiButton";
import {
  filterTemplates,
  resolveSlash,
  TEMPLATE_LISTBOX_ID,
  templateOptionId,
  TemplateMenu,
} from "@/components/inbox/composer/TemplateMenu";
import { useCreateNote } from "@/hooks/inbox/useCreateNote";
import { useMessageTemplates, type MessageTemplate } from "@/hooks/inbox/useMessageTemplates";
import { X } from "lucide-react";
import { useSendMessage } from "@/hooks/inbox/useSendMessage";
import { useUploadMedia } from "@/hooks/inbox/useUploadMedia";
import { useReplySuggestion } from "@/hooks/inbox/useReplySuggestion";
import { useGhostReplySuggestion } from "@/hooks/inbox/useGhostReplySuggestion";
import { imagensDoClipboard } from "@/lib/inbox/clipboard-image";
import { interpolateTemplate } from "@/lib/inbox/template-vars";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  createAttachmentQueueItems,
  processAttachmentQueue,
  skipFailedAttachment,
  type AttachmentQueueItem,
} from "@/lib/inbox/attachment-queue";
import {
  composerDraftKey,
  readComposerDraft,
  writeComposerDraft,
} from "@/lib/inbox/composer-draft";

export interface ComposerHandle {
  focus: () => void;
  enqueueFiles: (files: File[]) => void;
}

interface Props {
  conversationId: string;
  organizationId?: string;
  userId?: string;
  disabled?: boolean;
  /** Set true when contact is blocked / anonymized — explanation shown. */
  blockedReason?: string | null;
  /**
   * Janela de 24h fechada: barra a RESPOSTA, e só ela.
   *
   * Separado de `blockedReason` porque a nota interna nunca chega ao cliente —
   * a regra da plataforma não a alcança, e barrá-la tira do atendente
   * justamente o lugar onde ele registra por que a conversa esfriou. A primeira
   * versão deste bloqueio usava `blockedReason` e levou a nota junto.
   */
  janelaFechada?: string | null;
  /**
   * A mensagem que esta resposta CITA, quando o atendente escolheu responder
   * "em cima" de uma. `null` = envio solto, o caso comum.
   *
   * Vem de fora e não daqui porque quem escolhe é a lista de mensagens: o
   * composer só precisa mostrar o que foi escolhido e mandá-lo junto.
   */
  respondendo?: { id: string; body: string | null; direction: string } | null;
  /** Desfaz a escolha — o `x` da faixa de citação. */
  onCancelarResposta?: () => void;
  /** Nome do contato da conversa, para interpolar {{nome}}/{{primeiro_nome}} do template escolhido. */
  contactName?: string | null;
  /** Contato da conversa — excluído do seletor de cartão compartilhado. */
  currentContactId?: string | null;
  /** A conversa está sob comando humano e pode receber sugestão automática. */
  autoSuggestionEligible?: boolean;
  lastInboundAt?: string | null;
  lastOutboundAt?: string | null;
}

export const Composer = forwardRef<ComposerHandle, Props>(function Composer(
  {
    conversationId,
    organizationId,
    userId,
    disabled,
    blockedReason,
    janelaFechada,
    contactName,
    currentContactId,
    respondendo,
    onCancelarResposta,
    autoSuggestionEligible = false,
    lastInboundAt = null,
    lastOutboundAt = null,
  },
  ref,
) {
  const t = useT();
  const draftKey =
    organizationId && userId ? composerDraftKey(organizationId, userId, conversationId) : null;
  // O rascunho vem do localStorage DEPOIS da hidratação (efeito abaixo): ler o
  // navegador no inicializador do useState faria o cliente divergir do HTML do servidor.
  const [text, setText] = useState("");
  const [draftLoadedKey, setDraftLoadedKey] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<AttachmentQueueItem[]>([]);
  const attachmentsRef = useRef<AttachmentQueueItem[]>([]);
  const [activeAttachmentId, setActiveAttachmentId] = useState<string | null>(null);
  const [queueRunning, setQueueRunning] = useState(false);
  const queueRunningRef = useRef(false);
  const [catalogDraftQueue, setCatalogDraftQueue] = useState<RascunhoDoCatalogo[]>([]);
  const [catalogDraftTotal, setCatalogDraftTotal] = useState(0);
  const [catalogDraftPosition, setCatalogDraftPosition] = useState(0);
  const [catalogDraftLoading, setCatalogDraftLoading] = useState(false);
  const [catalogPreviewActive, setCatalogPreviewActive] = useState(false);
  const [catalogTextDraftActive, setCatalogTextDraftActive] = useState(false);
  const [contactPickerOpen, setContactPickerOpen] = useState(false);
  const [catalogPickerOpen, setCatalogPickerOpen] = useState(false);
  const [menuDismissed, setMenuDismissed] = useState(false);
  const [activeTemplateIndex, setActiveTemplateIndex] = useState(0);
  const [mode, setMode] = useState<"reply" | "note">("reply");
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const send = useSendMessage();
  const upload = useUploadMedia();
  const createNote = useCreateNote();
  const templates = useMessageTemplates();
  const slash = resolveSlash(text);
  const menuOpen = mode === "reply" && slash.open && !menuDismissed;
  const visibleTemplates = useMemo(
    () => filterTemplates(templates.data ?? [], slash.query),
    [slash.query, templates.data],
  );
  const normalizedActiveIndex = Math.min(
    activeTemplateIndex,
    Math.max(visibleTemplates.length - 1, 0),
  );
  const activeTemplate = visibleTemplates[normalizedActiveIndex];

  useEffect(() => {
    if (typeof window === "undefined" || !draftKey) {
      setDraftLoadedKey(null);
      return;
    }
    setText(readComposerDraft(window.localStorage, draftKey));
    setDraftLoadedKey(draftKey);
  }, [draftKey]);

  useEffect(() => {
    // Só grava depois de carregar o rascunho desta conversa: antes disso o campo
    // está vazio e gravaria por cima do que o atendente deixou guardado.
    if (typeof window !== "undefined" && draftKey && draftLoadedKey === draftKey) {
      writeComposerDraft(window.localStorage, draftKey, text);
    }
  }, [draftKey, draftLoadedKey, text]);

  // send/createNote fora do disable: o texto some na hora do envio; travar o campo
  // até a API voltar impedia digitar a próxima mensagem com o campo ainda cheio.
  const isDisabled = disabled || !!blockedReason || upload.isPending;
  // A janela só alcança o que SAI. Em modo nota o composer segue liberado: a
  // nota interna nunca chega ao cliente, e é onde o atendente registra por que
  // a conversa esfriou — barrá-la tira exatamente o que ainda dá para fazer.
  const respostaBarrada = isDisabled || (mode === "reply" && !!janelaFechada);
  const updateAttachments = useCallback(
    (next: AttachmentQueueItem[] | ((current: AttachmentQueueItem[]) => AttachmentQueueItem[])) => {
      const resolved = typeof next === "function" ? next(attachmentsRef.current) : next;
      attachmentsRef.current = resolved;
      setAttachments(resolved);
      setActiveAttachmentId((current) =>
        current && resolved.some((item) => item.id === current)
          ? current
          : (resolved.find((item) => item.status !== "sent" && item.status !== "skipped")?.id ??
            resolved[0]?.id ??
            null),
      );
    },
    [],
  );

  const enqueueFiles = useCallback(
    (files: File[]) => {
      if (mode !== "reply" || respostaBarrada || files.length === 0) return;
      const { accepted, rejected } = createAttachmentQueueItems(files);
      for (const rejectedFile of rejected) {
        toast.error(`${rejectedFile.file.name}: ${t(rejectedFile.message)}`);
      }
      if (accepted.length === 0) return;
      // Anexo já pendente não é substituído: a nova seleção entra no fim.
      updateAttachments((current) => [...current, ...accepted]);
    },
    [mode, respostaBarrada, t, updateAttachments],
  );

  useImperativeHandle(
    ref,
    () => ({ focus: () => taRef.current?.focus(), enqueueFiles }),
    [enqueueFiles],
  );
  const clienteAguardaResposta = Boolean(
    lastInboundAt && (!lastOutboundAt || Date.parse(lastInboundAt) > Date.parse(lastOutboundAt)),
  );
  const replySuggestion = useReplySuggestion({
    conversationId,
    autoEligible: autoSuggestionEligible && clienteAguardaResposta && !respostaBarrada,
    autoContextKey: lastInboundAt,
    composerEmpty: mode === "reply" && text.length === 0,
  });
  const usaTextoFantasma = Boolean(
    replySuggestion.currentDraft?.agent_managed &&
    replySuggestion.currentDraft.proposals.length === 0,
  );
  const ghost = useGhostReplySuggestion({
    conversationId,
    draft: replySuggestion.currentDraft,
    text,
    enabled: mode === "reply" && !respostaBarrada && usaTextoFantasma,
  });

  function autoresize() {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
  }

  useEffect(() => {
    if (
      catalogDraftQueue.length === 0 ||
      attachments.length > 0 ||
      catalogTextDraftActive ||
      catalogDraftLoading
    ) {
      return;
    }
    const [proximo, ...restantes] = catalogDraftQueue;
    if (!proximo) return;
    setCatalogDraftQueue(restantes);
    setCatalogDraftPosition((atual) => atual + 1);
    setMode("reply");

    const colocarLegendaNaCaixa = () => {
      setText((atual) => (atual.trim() ? `${atual.trimEnd()}\n\n${proximo.legenda}` : proximo.legenda));
      setCatalogTextDraftActive(true);
      requestAnimationFrame(() => {
        taRef.current?.focus();
        autoresize();
      });
    };

    if (!proximo.foto) {
      colocarLegendaNaCaixa();
      return;
    }

    setCatalogDraftLoading(true);
    void fetch(proximo.foto.url, { credentials: "same-origin" })
      .then(async (response) => {
        if (!response.ok) throw new Error("catalog_photo_load_failed");
        const blob = await response.blob();
        setCatalogPreviewActive(true);
        const file = new File([blob], proximo.foto!.nome_do_arquivo, {
            type: blob.type || proximo.foto!.mime,
          });
        const created = createAttachmentQueueItems([file]).accepted.map((item) => ({
          ...item,
          caption: proximo.legenda,
        }));
        updateAttachments(created);
      })
      .catch(() => {
        toast.warning(t("Não consegui carregar a foto. A legenda ficou no rascunho."));
        colocarLegendaNaCaixa();
      })
      .finally(() => setCatalogDraftLoading(false));
  }, [
    catalogDraftLoading,
    catalogDraftQueue,
    catalogTextDraftActive,
    attachments.length,
    t,
    updateAttachments,
  ]);

  const catalogSequenceLabel =
    catalogDraftTotal > 1 && catalogDraftPosition > 0
      ? t("Produto {atual} de {total}")
          .replace("{atual}", String(catalogDraftPosition))
          .replace("{total}", String(catalogDraftTotal))
      : undefined;

  function handleSubmit() {
    // Se o atendente aceitou e não tocou no texto, preserve byte a byte para o
    // banco registrar "approved". Qualquer edição segue o comportamento antigo
    // do composer e remove apenas o espaço acidental das pontas.
    const body = ghost.acceptedDraft?.original_body === text ? text : text.trim();
    const rascunhoDeTextoDoCatalogo = catalogTextDraftActive;
    if (!body || (mode === "note" ? isDisabled : respostaBarrada)) return;

    setText("");
    requestAnimationFrame(() => autoresize());

    const restoreOnError = () => {
      setText(body);
      requestAnimationFrame(() => autoresize());
    };

    if (mode === "note") {
      createNote.mutate({ conversation_id: conversationId, body }, { onError: restoreOnError });
      return;
    }
    if (ghost.acceptedDraft) {
      void replySuggestion
        .approve(ghost.acceptedDraft, body)
        .then(() => {
          ghost.finish();
          onCancelarResposta?.();
        })
        .catch(restoreOnError);
      return;
    }
    send.mutate(
      {
        conversation_id: conversationId,
        body,
        type: "text",
        ...(respondendo ? { reply_to_message_id: respondendo.id } : {}),
      },
      {
        onSuccess: () => {
          setText("");
          if (rascunhoDeTextoDoCatalogo) setCatalogTextDraftActive(false);
          // A citação vale para UMA mensagem. Mantê-la depois do envio faria a
          // próxima frase sair citando algo que o atendente já respondeu.
          onCancelarResposta?.();
          requestAnimationFrame(() => autoresize());
        },
        // Do upstream, e fica: sem isto o texto some quando o envio falha, e
        // quem escreveu um parágrafo o perde sem ter como recuperá-lo.
        onError: restoreOnError,
      },
    );
  }

  function acceptGhost() {
    const accepted = ghost.accept();
    if (!accepted) return;
    setText(accepted);
    requestAnimationFrame(() => {
      const ta = taRef.current;
      if (!ta) return;
      ta.focus();
      ta.selectionStart = ta.selectionEnd = accepted.length;
      autoresize();
    });
  }

  async function generateManually() {
    const draft = await replySuggestion.generateManually();
    if (!draft) return;
    ghost.restore(draft.id);
    requestAnimationFrame(() => taRef.current?.focus());
  }

  function applyTemplate(template: MessageTemplate) {
    const filled = interpolateTemplate(template.body, { name: contactName ?? null });
    const mediaUrl = template.media_storage_path
      ? `/api/v1/message-templates/${template.id}/media`
      : template.audio_storage_path
        ? `/api/v1/message-templates/${template.id}/audio`
        : null;
    if (mediaUrl) {
      void (async () => {
        try {
          const response = await fetch(mediaUrl, { credentials: "same-origin" });
          if (!response.ok) throw new Error("shortcut_media_download_failed");
          const blob = await response.blob();
          const nome =
            template.media_file_name ?? template.audio_file_name ?? `atalho-${template.id}`;
          const file = new File([blob], nome, { type: blob.type || "application/octet-stream" });
          const created = createAttachmentQueueItems([file]).accepted.map((item) => ({
            ...item,
            caption: filled,
          }));
          updateAttachments((current) => [...current, ...created]);
          setText("");
          setMenuDismissed(true);
        } catch {
          toast.error(t("Não consegui carregar a mídia deste atalho."));
        }
      })();
      return;
    }
    setText(filled);
    setMenuDismissed(true);
    const ta = taRef.current;
    if (!ta) return;
    requestAnimationFrame(() => {
      ta.focus();
      ta.selectionStart = ta.selectionEnd = filled.length;
      autoresize();
    });
  }

  /**
   * Ctrl/Cmd+V com imagem no clipboard cai no MESMO caminho do menu "+":
   * abre o preview com legenda e envia por ali. Nada de atalho paralelo — a
   * validação, o toast de erro e o retry já vivem lá.
   *
   * As três guardas antes de olhar o clipboard não são zelo: em "Nota interna"
   * não existe anexo (a nota é só texto e o envio nem passa pelo upload), com
   * uma fila já aberta recebe as novas imagens ao final, sem substituir o que
   * o operador escolheu, e desabilitado é desabilitado.
   */
  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    if (mode !== "reply" || respostaBarrada) return;
    const imagens = imagensDoClipboard(e.clipboardData, new Date());
    if (imagens.length === 0) return; // colagem de texto segue o caminho normal do browser
    e.preventDefault();
    enqueueFiles(imagens);
  }

  async function runAttachmentQueue(): Promise<void> {
    if (queueRunningRef.current || attachmentsRef.current.length === 0) return;
    queueRunningRef.current = true;
    setQueueRunning(true);
    try {
      const result = await processAttachmentQueue(
        attachmentsRef.current,
        async (item) => {
          const uploaded = await upload.mutateAsync({ conversationId, file: item.file });
          await new Promise<void>((resolve, reject) => {
            send.mutate(
              {
                conversation_id: conversationId,
                type: uploaded.kind,
                body: item.caption.trim() || undefined,
                media_storage_path: uploaded.storage_path,
                media_mime: uploaded.media_mime,
                media_size_bytes: uploaded.media_size_bytes,
              },
              { onSuccess: () => resolve(), onError: reject },
            );
          });
        },
        updateAttachments,
      );
      updateAttachments(result.items);
      if (result.status === "completed") {
        updateAttachments([]);
        setCatalogPreviewActive(false);
      }
    } finally {
      queueRunningRef.current = false;
      setQueueRunning(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (ghost.visible && text.length === 0 && e.key === "Tab") {
      e.preventDefault();
      acceptGhost();
      return;
    }
    if (ghost.visible && text.length === 0 && e.key === "Escape") {
      e.preventDefault();
      const dismissed = ghost.dismiss();
      if (dismissed) void replySuggestion.reject(dismissed);
      return;
    }
    if (menuOpen) {
      if (e.key === "Escape") {
        e.preventDefault();
        setMenuDismissed(true);
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (visibleTemplates.length > 0) {
          setActiveTemplateIndex((normalizedActiveIndex + 1) % visibleTemplates.length);
        }
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        if (visibleTemplates.length > 0) {
          setActiveTemplateIndex(
            (normalizedActiveIndex - 1 + visibleTemplates.length) % visibleTemplates.length,
          );
        }
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (activeTemplate) applyTemplate(activeTemplate);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  if (blockedReason) {
    return (
      <div className="border-t border-border bg-muted/40 px-4 py-3 text-center text-xs text-muted-foreground">
        {blockedReason}
      </div>
    );
  }

  return (
    <>
      <div
        className={cn(
          "relative flex min-h-0 flex-1 flex-col overflow-hidden border-t border-border bg-background px-3 py-2",
          mode === "note" && "border-warning/40 bg-warning-bg",
        )}
      >
        {mode === "reply" && !usaTextoFantasma && (
          <div
            data-testid="reply-review-scroll"
            className="mb-3 max-h-[min(16rem,32dvh)] min-h-0 flex-1 overflow-y-auto overscroll-contain"
          >
            <ReplyReviewPanel conversationId={conversationId} disabled={isDisabled} />
          </div>
        )}
        <TemplateMenu
          open={menuOpen}
          query={slash.query}
          templates={templates.data ?? []}
          activeIndex={normalizedActiveIndex}
          onPick={applyTemplate}
          onActiveIndexChange={setActiveTemplateIndex}
        />
        <div data-testid="composer-controls" className="shrink-0">
          <div className="mb-1.5 flex gap-1">
            <button
              type="button"
              onClick={() => setMode("reply")}
              className={cn(
                "rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
                mode === "reply"
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-muted",
              )}
            >
              {t("Responder")}
            </button>
            <button
              type="button"
              onClick={() => setMode("note")}
              disabled={catalogTextDraftActive}
              className={cn(
                "rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
                mode === "note"
                  ? "bg-warning text-warning-fg"
                  : "text-muted-foreground hover:bg-muted",
              )}
            >
              {t("Nota interna")}
            </button>
          </div>
          {/*
          A FAIXA DA CITAÇÃO — o que o atendente escolheu responder.

          Fica ACIMA do campo, como no WhatsApp, e não dentro dele: o texto
          citado pode ter várias linhas, e empurrá-lo para dentro do campo faria
          o que se digita disputar espaço com o que se cita.

          `line-clamp-2` porque o objetivo é reconhecer qual mensagem é, não
          relê-la — ela está logo acima, no fio.
        */}
          {respondendo && mode === "reply" && (
            <div className="mb-1 flex items-start gap-2 rounded-md border-l-2 border-primary bg-muted/60 px-2 py-1.5">
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-medium text-primary">
                  {respondendo.direction === "outbound" ? t("Você") : t("Cliente")}
                </div>
                <div className="line-clamp-2 text-xs text-muted-foreground">
                  {respondendo.body?.trim() || t("(sem texto)")}
                </div>
              </div>
              <button
                type="button"
                onClick={onCancelarResposta}
                aria-label={t("Cancelar resposta")}
                className="rounded-md p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>
          )}
          <div className="sr-only" aria-live="polite" aria-atomic="true">
            {replySuggestion.isPreparing
              ? t("Preparando sugestão")
              : ghost.visible
                ? `${t("Sugestão disponível")}: ${ghost.ghostText}. ${t("Pressione Tab para usar.")}`
                : ""}
          </div>
          {mode === "reply" && replySuggestion.isPreparing && (
            <p className="mb-1 text-[11px] text-muted-foreground" role="status">
              {t("Preparando sugestão…")}
            </p>
          )}
          {mode === "reply" && ghost.visible && (
            <button
              type="button"
              className="mb-1.5 w-fit rounded-full border bg-muted/40 px-2.5 py-1 text-xs text-muted-foreground md:hidden"
              onClick={acceptGhost}
            >
              {t("Usar sugestão")}
            </button>
          )}
          {catalogTextDraftActive && catalogSequenceLabel ? (
            <p className="mb-1.5 text-xs text-muted-foreground" role="status">
              {catalogSequenceLabel}
            </p>
          ) : null}
          <div className="flex items-end gap-2">
            {mode === "reply" && (
              <AttachMenu
                disabled={respostaBarrada}
                onPick={(files) => {
                  setCatalogPreviewActive(false);
                  enqueueFiles(files);
                }}
                onPickContact={() => setContactPickerOpen(true)}
                onPickCatalog={() => setCatalogPickerOpen(true)}
              />
            )}
            <EmojiButton
              disabled={isDisabled}
              onPick={(emoji) => {
                const ta = taRef.current;
                if (!ta) {
                  setText((current) => {
                    const next = current + emoji;
                    ghost.dismissByTyping(next);
                    return next;
                  });
                  return;
                }
                const start = ta.selectionStart ?? text.length;
                const end = ta.selectionEnd ?? text.length;
                const next = text.slice(0, start) + emoji + text.slice(end);
                ghost.dismissByTyping(next);
                setText(next);
                requestAnimationFrame(() => {
                  ta.focus();
                  ta.selectionStart = ta.selectionEnd = start + emoji.length;
                  autoresize();
                });
              }}
            />
            {mode === "reply" && usaTextoFantasma && (
              <DraftReplyButton
                onClick={() => void generateManually()}
                pending={replySuggestion.isPreparing}
                disabled={respostaBarrada || text.length > 0 || !replySuggestion.assistant.enabled}
              />
            )}
            <textarea
              ref={taRef}
              value={text}
              onChange={(e) => {
                ghost.dismissByTyping(e.target.value);
                setText(e.target.value);
                setMenuDismissed(false);
                setActiveTemplateIndex(0);
                autoresize();
              }}
              onKeyDown={onKeyDown}
              onPaste={onPaste}
              rows={1}
              // O atalho saiu do placeholder e foi para o diálogo de atalhos (`?`)
              // e para o `title` aqui. Dois motivos, nesta ordem: ele some assim
              // que se digita a primeira letra — isto é, some justamente quando
              // você ia quebrar linha —; e, com a coluna do inbox mais estreita
              // depois do conserto do layout, a frase quebrava em duas linhas
              // dentro de um campo de uma linha só.
              //
              // "(só o time vê)" FICA: não é atalho, é consequência. Quem escreve
              // uma nota interna precisa saber que ela não vai para o cliente, e
              // essa informação não pode depender de abrir um diálogo.
              placeholder={
                ghost.visible
                  ? ghost.ghostText
                  : mode === "note"
                    ? t("Escreva uma nota interna… (só o time vê)")
                    : t("Escreva uma mensagem…")
              }
              title={
                mode === "note"
                  ? t("Enter salva a nota · Shift+Enter quebra linha")
                  : t("Enter envia · Shift+Enter quebra linha")
              }
              className={cn(
                "max-h-40 min-h-9 flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm",
                "placeholder:text-foreground/70 focus:ring-1 focus:ring-ring focus:outline-hidden",
              )}
              disabled={mode === "note" ? isDisabled : respostaBarrada}
              aria-label={t("Mensagem")}
              aria-describedby={ghost.visible ? "reply-suggestion-help" : undefined}
              // Continua sendo caixa de texto (`textbox`): trocar o papel para
              // `combobox` fez as telas e os testes que procuram "Mensagem" não
              // acharem mais o campo. `aria-expanded` não vale para `textbox`.
              aria-autocomplete="list"
              aria-haspopup="listbox"
              aria-controls={menuOpen ? TEMPLATE_LISTBOX_ID : undefined}
              aria-activedescendant={
                menuOpen && activeTemplate ? templateOptionId(activeTemplate.id) : undefined
              }
            />
            {ghost.visible && (
              <span id="reply-suggestion-help" className="sr-only">
                {t("Pressione Tab para usar a sugestão ou Escape para dispensar.")}
              </span>
            )}
            {text.trim() || mode === "note" ? (
              <Button
                type="button"
                size="icon"
                className="h-9 w-9 shrink-0"
                onClick={handleSubmit}
                disabled={(mode === "note" ? isDisabled : respostaBarrada) || !text.trim()}
                aria-label={t("Enviar")}
              >
                <PaperPlaneTilt size={16} weight="fill" aria-hidden />
              </Button>
            ) : (
              <AudioRecorder conversationId={conversationId} disabled={respostaBarrada} />
            )}
          </div>
        </div>
      </div>
      <AttachmentPreviewDialog
        items={attachments}
        activeItemId={activeAttachmentId}
        sequenceLabel={catalogPreviewActive ? catalogSequenceLabel : undefined}
        sending={queueRunning || upload.isPending || send.isPending}
        onSelectItem={setActiveAttachmentId}
        onCaptionChange={(id, caption) =>
          updateAttachments((current) =>
            current.map((item) => (item.id === id ? { ...item, caption } : item)),
          )
        }
        onCancel={() => {
          updateAttachments([]);
          setCatalogPreviewActive(false);
        }}
        onSend={() => void runAttachmentQueue()}
        onRetry={() => void runAttachmentQueue()}
        onSkip={() => {
          const failed = attachmentsRef.current.find((item) => item.status === "failed");
          if (!failed) return;
          updateAttachments(skipFailedAttachment(attachmentsRef.current, failed.id));
          void runAttachmentQueue();
        }}
        onCancelRemaining={() => {
          updateAttachments([]);
          setCatalogPreviewActive(false);
        }}
      />
      <ContactPickerDialog
        open={contactPickerOpen}
        onOpenChange={setContactPickerOpen}
        excludeContactId={currentContactId}
        sending={send.isPending}
        onPick={(payload) => {
          send.mutate(
            {
              conversation_id: conversationId,
              type: "contact",
              metadata: payload.contactId
                ? { shared_contact_id: payload.contactId }
                : {
                    shared_contact: {
                      name: payload.name,
                      phone_number: payload.phone_number,
                    },
                  },
            },
            { onSuccess: () => setContactPickerOpen(false) },
          );
        }}
      />
      <CatalogPickerDialog
        open={catalogPickerOpen}
        onOpenChange={setCatalogPickerOpen}
        conversationId={conversationId}
        onDrafts={(drafts) => {
          setCatalogDraftQueue(drafts);
          setCatalogDraftTotal(drafts.length);
          setCatalogDraftPosition(0);
          setCatalogTextDraftActive(false);
        }}
      />
    </>
  );
});
