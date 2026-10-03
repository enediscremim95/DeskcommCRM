"use client";
import { useT } from "@/hooks/i18n/useT";
import type { MessageTemplate } from "@/hooks/inbox/useMessageTemplates";

export const TEMPLATE_LISTBOX_ID = "message-template-listbox";

export function templateOptionId(templateId: string): string {
  return `message-template-option-${templateId}`;
}

/** Estado do slash-menu a partir do texto do composer. Puro (testável). */
export function resolveSlash(text: string): { open: boolean; query: string } {
  if (!text.startsWith("/")) return { open: false, query: "" };
  const rest = text.slice(1);
  if (/\s/.test(rest)) return { open: false, query: "" };
  return { open: true, query: rest };
}

interface Props {
  open: boolean;
  query: string;
  templates: MessageTemplate[];
  activeIndex: number;
  onPick: (t: MessageTemplate) => void;
  onActiveIndexChange: (index: number) => void;
}

export function filterTemplates(templates: MessageTemplate[], query: string): MessageTemplate[] {
  const normalizedQuery = query.trim().toLocaleLowerCase("pt-BR");
  return templates.filter(
    (template) =>
      template.title.toLocaleLowerCase("pt-BR").includes(normalizedQuery) ||
      (template.shortcut ?? "").toLocaleLowerCase("pt-BR").includes(normalizedQuery),
  );
}

export function TemplateMenu({
  open,
  query,
  templates,
  activeIndex,
  onPick,
  onActiveIndexChange,
}: Props) {
  const t = useT();
  if (!open) return null;
  const filtered = filterTemplates(templates, query);
  return (
    <div
      id={TEMPLATE_LISTBOX_ID}
      className="absolute bottom-14 left-3 z-20 max-h-[min(16rem,30dvh)] w-[min(20rem,calc(100%-1.5rem))] overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg"
      role="listbox"
      aria-label={t("Modelos de mensagem")}
    >
      {filtered.length === 0 ? (
        <div className="px-3 py-2 text-xs text-muted-foreground">
          {t("Nenhum modelo salvo. Crie em Modelos de mensagem.")}
        </div>
      ) : (
        filtered.map((tpl, index) => (
          <button
            key={tpl.id}
            id={templateOptionId(tpl.id)}
            type="button"
            role="option"
            aria-selected={index === activeIndex}
            className="flex w-full flex-col items-start gap-0.5 rounded-md px-3 py-2 text-left hover:bg-muted aria-selected:bg-muted"
            onMouseMove={() => onActiveIndexChange(index)}
            onClick={() => onPick(tpl)}
          >
            <span className="flex w-full items-center justify-between gap-2 text-sm font-medium">
              <span>{tpl.title}</span>
              {tpl.shortcut ? (
                <span className="shrink-0 text-xs font-normal text-muted-foreground">
                  /{tpl.shortcut}
                </span>
              ) : null}
            </span>
            <span className="line-clamp-1 text-xs text-muted-foreground">{tpl.body}</span>
          </button>
        ))
      )}
    </div>
  );
}
