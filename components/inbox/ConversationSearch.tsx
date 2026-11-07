"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/hooks/i18n/useT";
import { CaretLeft, CaretRight, MagnifyingGlass, X } from "@/lib/ui/icons";

export interface ConversationSearchResult {
  message_id: string;
  sent_at: string;
  snippet: string;
  direction: "inbound" | "outbound";
  type: string;
}

interface Props {
  conversationId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onJump: (messageId: string) => Promise<void> | void;
}

interface SearchResponse {
  data: ConversationSearchResult[];
  meta?: { cursor?: string | null; has_more?: boolean };
}

export function ConversationSearch({ conversationId, open, onOpenChange, onJump }: Props) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ConversationSearchResult[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);

  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  async function requestPage(term: string, pageCursor?: string): Promise<SearchResponse> {
    const params = new URLSearchParams({ q: term, limit: "50" });
    if (pageCursor) params.set("cursor", pageCursor);
    const response = await fetch(
      `/api/v1/conversations/${conversationId}/messages/search?${params.toString()}`,
      { credentials: "same-origin" },
    );
    const body = (await response.json()) as SearchResponse & { error?: { message?: string } };
    if (!response.ok) throw new Error(body.error?.message ?? "message_search_failed");
    return body;
  }

  async function search(event?: FormEvent): Promise<void> {
    event?.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    try {
      const body = await requestPage(trimmed);
      setResults(body.data);
      setCursor(body.meta?.cursor ?? null);
      setHasMore(body.meta?.has_more === true);
      const next = body.data.length > 0 ? 0 : -1;
      setActiveIndex(next);
      if (next >= 0) await onJump(body.data[next]!.message_id);
    } catch {
      setResults([]);
      setActiveIndex(-1);
      setCursor(null);
      setHasMore(false);
      setError(t("Não foi possível buscar nesta conversa."));
    } finally {
      setLoading(false);
    }
  }

  async function move(delta: number): Promise<void> {
    if (results.length === 0) return;
    if (delta > 0 && activeIndex === results.length - 1 && hasMore && cursor) {
      setLoading(true);
      setError(null);
      try {
        const body = await requestPage(query.trim(), cursor);
        if (body.data.length === 0) {
          setCursor(null);
          setHasMore(false);
          return;
        }
        const next = results.length;
        setResults((current) => [...current, ...body.data]);
        setCursor(body.meta?.cursor ?? null);
        setHasMore(body.meta?.has_more === true);
        setActiveIndex(next);
        await onJump(body.data[0]!.message_id);
      } catch {
        setError(t("Não foi possível buscar nesta conversa."));
      } finally {
        setLoading(false);
      }
      return;
    }
    const next = (activeIndex + delta + results.length) % results.length;
    setActiveIndex(next);
    await onJump(results[next]!.message_id);
  }

  if (!open) return null;
  const active = activeIndex >= 0 ? results[activeIndex] : null;

  return (
    <div className="border-b border-border bg-background px-3 py-2" data-testid="conversation-search">
      <form className="flex items-center gap-2" onSubmit={(event) => void search(event)}>
        <MagnifyingGlass size={16} className="shrink-0 text-muted-foreground" aria-hidden />
        <Input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("Buscar nesta conversa")}
          aria-label={t("Buscar nesta conversa")}
          className="h-8 min-w-0 flex-1"
          maxLength={200}
        />
        <Button type="submit" size="sm" variant="outline" disabled={loading || !query.trim()}>
          {loading ? t("Buscando…") : t("Buscar")}
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          onClick={() => void move(-1)}
          disabled={results.length === 0}
          aria-label={t("Resultado anterior")}
        >
          <CaretLeft size={15} aria-hidden />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          onClick={() => void move(1)}
          disabled={results.length === 0}
          aria-label={t("Próximo resultado")}
        >
          <CaretRight size={15} aria-hidden />
        </Button>
        <span className="min-w-12 text-center text-xs text-muted-foreground" aria-live="polite">
          {results.length > 0 ? `${activeIndex + 1}/${results.length}` : "0/0"}
        </span>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          onClick={() => onOpenChange(false)}
          aria-label={t("Fechar busca")}
        >
          <X size={15} aria-hidden />
        </Button>
      </form>
      {error ? (
        <p className="mt-1 text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : active ? (
        <button
          type="button"
          className="mt-1 block w-full truncate text-left text-xs text-muted-foreground hover:text-foreground"
          onClick={() => void onJump(active.message_id)}
        >
          {active.snippet}
        </button>
      ) : query.trim() && !loading ? (
        <p className="mt-1 text-xs text-muted-foreground">{t("Nenhuma mensagem encontrada.")}</p>
      ) : null}
    </div>
  );
}
