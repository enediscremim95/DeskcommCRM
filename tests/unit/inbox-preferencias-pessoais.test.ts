import { describe, expect, it } from "vitest";

import { orderConversationsWithPinnedFirst } from "@/components/inbox/ConversationList";
import { tabToFilter } from "@/components/inbox/InboxLayout";
import {
  ESTADO_CONVERSA_VAZIO,
  proximoEstadoPessoalDaConversa,
} from "@/lib/inbox/preferencias-pessoais";
import type { ConversationWithContact } from "@/hooks/inbox/useConversationsRealtime";

function conversa(id: string, pinned_at: string | null = null): ConversationWithContact {
  return { id, pinned_at } as ConversationWithContact;
}

describe("preferências pessoais do Inbox", () => {
  it("é idempotente e preserva a data ao favoritar ou fixar novamente", () => {
    const primeira = proximoEstadoPessoalDaConversa(
      ESTADO_CONVERSA_VAZIO,
      { favorited: true, pinned: true },
      "2026-11-07T10:00:00.000Z",
    );
    const repetida = proximoEstadoPessoalDaConversa(
      primeira,
      { favorited: true, pinned: true },
      "2026-11-07T11:00:00.000Z",
    );
    expect(repetida).toEqual(primeira);
  });

  it("ordena fixadas por pinned_at e mantém a ordem das demais", () => {
    expect(
      orderConversationsWithPinnedFirst(
        [conversa("normal-1"), conversa("pin-antiga"), conversa("normal-2")],
        [
          conversa("pin-antiga", "2026-11-07T10:00:00.000Z"),
          conversa("pin-nova", "2026-11-07T11:00:00.000Z"),
        ],
      ).map((item) => item.id),
    ).toEqual(["pin-nova", "pin-antiga", "normal-1", "normal-2"]);
  });

  it("Favoritas filtra só o estado pessoal sem alterar as abas existentes", () => {
    expect(tabToFilter("favorites")).toEqual({ favorited: true });
    expect(tabToFilter("closed")).toEqual({ status: "closed" });
    expect(tabToFilter("ai")).toEqual({ comando: ["automatico"] });
  });
});
