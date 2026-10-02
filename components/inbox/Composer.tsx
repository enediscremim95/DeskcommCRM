"use client";
import { useT } from "@/hooks/i18n/useT";
import {
  forwardRef,
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
import { AudioRecorder } from "@/components/inbox/composer/AudioRecorder";
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
import { imagemDoClipboard } from "@/lib/inbox/clipboard-image";
import { interpolateTemplate } from "@/lib/inbox/template-vars";
import { cn } from "@/lib/utils";

export interface ComposerHandle {
  focus: () => void;
}

interface Props {
  conversationId: string;
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
}

export const Composer = forwardRef<ComposerHandle, Props>(function Composer(
  {
    conversationId,
    disabled,
    blockedReason,
    janelaFechada,
    contactName,
    currentContactId,
    respondendo,
    onCancelarResposta,
  },
  ref,
) {
  const t = useT();
  const [text, setText] = useState("");
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [contactPickerOpen, setContactPickerOpen] = useState(false);
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

  useImperativeHandle(ref, () => ({
    focus: () => taRef.current?.focus(),
  }));

  // send/createNote fora do disable: o texto some na hora do envio; travar o campo
  // até a API voltar impedia digitar a próxima mensagem com o campo ainda cheio.
  const isDisabled = disabled || !!blockedReason || upload.isPending;
  // A janela só alcança o que SAI. Em modo nota o composer segue liberado: a
  // nota interna nunca chega ao cliente, e é onde o atendente registra por que
  // a conversa esfriou — barrá-la tira exatamente o que ainda dá para fazer.
  const respostaBarrada = isDisabled || (mode === "reply" && !!janelaFechada);

  function autoresize() {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
  }

  function handleSubmit() {
    const body = text.trim();
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

  function applyTemplate(t: MessageTemplate) {
    const filled = interpolateTemplate(t.body, { name: contactName ?? null });
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
   * um anexo já em preview a colagem substituiria em silêncio o que o operador
   * escolheu, e desabilitado é desabilitado. Em qualquer um desses casos o
   * Ctrl+V precisa continuar sendo o Ctrl+V de sempre.
   */
  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    if (mode !== "reply" || respostaBarrada || pendingFile) return;
    const imagem = imagemDoClipboard(e.clipboardData, new Date());
    if (!imagem) return; // colagem de texto segue o caminho normal do browser
    e.preventDefault();
    setPendingFile(imagem);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
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
        {mode === "reply" && (
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
          <div className="flex items-end gap-2">
            {mode === "reply" && (
              <AttachMenu
                disabled={respostaBarrada}
                onPick={setPendingFile}
                onPickContact={() => setContactPickerOpen(true)}
              />
            )}
            <EmojiButton
              disabled={isDisabled}
              onPick={(emoji) => {
                const ta = taRef.current;
                if (!ta) {
                  setText((t) => t + emoji);
                  return;
                }
                const start = ta.selectionStart ?? text.length;
                const end = ta.selectionEnd ?? text.length;
                const next = text.slice(0, start) + emoji + text.slice(end);
                setText(next);
                requestAnimationFrame(() => {
                  ta.focus();
                  ta.selectionStart = ta.selectionEnd = start + emoji.length;
                  autoresize();
                });
              }}
            />
            <textarea
              ref={taRef}
              value={text}
              onChange={(e) => {
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
                mode === "note"
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
                "placeholder:text-muted-foreground focus:ring-1 focus:ring-ring focus:outline-hidden",
              )}
              disabled={mode === "note" ? isDisabled : respostaBarrada}
              aria-label={t("Mensagem")}
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
        file={pendingFile}
        sending={upload.isPending || send.isPending}
        onCancel={() => setPendingFile(null)}
        onSend={async (caption) => {
          if (!pendingFile) return;
          try {
            const uploaded = await upload.mutateAsync({ conversationId, file: pendingFile });
            send.mutate(
              {
                conversation_id: conversationId,
                type: uploaded.kind,
                body: caption || undefined,
                media_storage_path: uploaded.storage_path,
                media_mime: uploaded.media_mime,
                media_size_bytes: uploaded.media_size_bytes,
              },
              { onSuccess: () => setPendingFile(null) },
            );
          } catch {
            // toast já disparado pelo onError de useUploadMedia; dialog fica aberto p/ retry
            return;
          }
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
    </>
  );
});
