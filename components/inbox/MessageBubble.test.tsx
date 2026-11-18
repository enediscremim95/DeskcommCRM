/**
 * O balão diz de quem saiu a mensagem.
 *
 * `external_device` é a resposta dada pelo WhatsApp do CELULAR (fora do CRM) —
 * antes ela chegava à bolha sem rótulo, indistinguível do que foi digitado no
 * CRM. Este teste prende cada valor de `sent_via` ao rótulo certo, mais o caso
 * que NÃO leva rótulo (mensagem recebida).
 *
 * `sent_via='user'` não diz QUAL humano digitou — só que um humano digitou. Por
 * isso "Você" depende de duas pontas: `viewerUserId` (quem lê) e
 * `sent_by_user_id` (quem enviou). Faltando qualquer uma, o rótulo é
 * "Atendente"; os casos abaixo prendem as três combinações (sou eu, é o colega,
 * não se sabe).
 *
 * Não há caso para `'automation'`: nenhum emissor grava esse valor, e o
 * componente deixou de nomeá-lo. Quem guarda essa propriedade — nas duas
 * direções — é tests/unit/rotulo-de-origem-tem-emissor.test.ts.
 *
 * Sem provider de idioma o `t()` degrada para a chave (pt-BR), então o texto
 * esperado é o português — o espanhol é coberto por i18n-espanhol-cobre-a-tela.
 */
import { describe, it, expect } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";

import { MessageBubble } from "./MessageBubble";
import type { Message } from "@/lib/types/messaging";

function msg(over: Partial<Message> = {}): Message {
  return {
    id: "m1",
    organization_id: "org1",
    conversation_id: "c1",
    channel_session_id: "s1",
    contact_id: "ct1",
    external_id: null,
    type: "text",
    direction: "outbound",
    status: "sent",
    ack: null,
    error_code: null,
    error_message: null,
    body: "corpo da mensagem",
    media_url: null,
    media_mime: null,
    media_size_bytes: null,
    media_storage_path: null,
    sent_via: "user",
    sent_by_user_id: null,
    sent_at: "2026-09-08T12:00:00.000Z",
    delivered_at: null,
    read_at: null,
    metadata: {},
    edited_at: null,
    revoked_at: null,
    reply_to_message_id: null,
    created_at: "2026-09-08T12:00:00.000Z",
    ...over,
  };
}

describe("MessageBubble — rótulo de origem", () => {
  it("resposta pelo celular (external_device) mostra 'Celular'", () => {
    render(<MessageBubble message={msg({ sent_via: "external_device" })} />);
    expect(screen.getByText("Celular")).toBeInTheDocument();
  });

  it("automação não inventa rótulo — ninguém grava esse valor", () => {
    render(<MessageBubble message={msg({ sent_via: "automation" })} />);
    expect(screen.queryByText("Automação")).not.toBeInTheDocument();
  });

  it("digitada no CRM por QUEM ESTÁ LENDO mostra 'Você'", () => {
    render(
      <MessageBubble
        message={msg({ sent_via: "user", sent_by_user_id: "u-eu" })}
        viewerUserId="u-eu"
      />,
    );
    expect(screen.getByText("Você")).toBeInTheDocument();
  });

  it("digitada no CRM pelo COLEGA mostra 'Atendente', nunca 'Você'", () => {
    render(
      <MessageBubble
        message={msg({ sent_via: "user", sent_by_user_id: "u-colega" })}
        viewerUserId="u-eu"
      />,
    );
    expect(screen.getByText("Atendente")).toBeInTheDocument();
    expect(screen.queryByText("Você")).not.toBeInTheDocument();
  });

  it("sem emissor gravado (sent_by_user_id nulo) mostra 'Atendente'", () => {
    // Os dois nulos se equivalem em `===`. Sem a guarda de `viewerUserId != null`
    // este caso voltaria a dizer "Você" para uma mensagem de dono desconhecido.
    render(<MessageBubble message={msg({ sent_via: "user", sent_by_user_id: null })} />);
    expect(screen.getByText("Atendente")).toBeInTheDocument();
    expect(screen.queryByText("Você")).not.toBeInTheDocument();
  });

  it("crm (o DEFAULT da coluna) segue a mesma regra de 'user'", () => {
    render(
      <MessageBubble
        message={msg({ sent_via: "crm", sent_by_user_id: "u-eu" })}
        viewerUserId="u-eu"
      />,
    );
    expect(screen.getByText("Você")).toBeInTheDocument();
  });

  it("IA continua mostrando 'IA' (comportamento preservado)", () => {
    render(<MessageBubble message={msg({ sent_via: "ai" })} />);
    expect(screen.getByText("IA")).toBeInTheDocument();
  });

  it("mensagem recebida (inbound) não leva rótulo de origem", () => {
    render(
      <MessageBubble message={msg({ sent_via: "external_device", direction: "inbound" })} />,
    );
    expect(screen.queryByText("Celular")).not.toBeInTheDocument();
  });

  it("system não inventa rótulo", () => {
    render(<MessageBubble message={msg({ sent_via: "system" })} />);
    for (const rotulo of ["Celular", "Automação", "Você", "Atendente", "IA"]) {
      expect(screen.queryByText(rotulo)).not.toBeInTheDocument();
    }
  });
});

describe("MessageBubble — mídia recebida guardada", () => {
  it.each([
    ["image", "img"],
    ["audio", "audio"],
    ["video", "video"],
  ] as const)("renderiza %s pelo endpoint protegido quando existe storage path", (type, tag) => {
    const { container } = render(
      <MessageBubble
        message={msg({
          direction: "inbound",
          type,
          body: null,
          media_mime: `${type}/teste`,
          media_storage_path: `org1/c1/m1.${type}`,
        })}
      />,
    );

    expect(container.querySelector(tag)).toHaveAttribute("src", "/api/v1/messages/m1/media");
    expect(screen.queryByTestId("media-not-stored")).not.toBeInTheDocument();
  });

  it("mantém a mensagem e explica quando o arquivo saiu por idade", () => {
    const { container } = render(
      <MessageBubble
        message={msg({
          direction: "inbound",
          type: "video",
          body: "Legenda que continua na conversa",
          media_storage_path: null,
          metadata: {
            media_status: "not_stored",
            media_discard_reason: "retention_expired",
            media_filename: "visita.mp4",
          },
        })}
      />,
    );

    expect(screen.getByText("Arquivo removido após o prazo de retenção: visita.mp4")).toBeInTheDocument();
    expect(screen.getByText("Legenda que continua na conversa")).toBeInTheDocument();
    expect(container.querySelector("video")).toBeNull();
  });
});

describe("MessageBubble — encaminhamento", () => {
  it.each(["text", "image", "video", "document", "audio"])(
    "mostra o botão para mensagem %s elegível",
    (type) => {
      const onEncaminhar = vi.fn();
      render(<MessageBubble message={msg({ type })} onEncaminhar={onEncaminhar} />);
      fireEvent.click(screen.getByRole("button", { name: "Encaminhar esta mensagem" }));
      expect(onEncaminhar).toHaveBeenCalledOnce();
    },
  );

  it.each([
    ["apagada", { revoked_at: "2026-11-06T10:00:00.000Z" }],
    ["falha", { status: "failed" }],
    ["nota interna pelo tipo", { type: "internal_note" }],
    ["nota interna pelos metadados", { metadata: { internal_note: true } }],
    ["evento de sistema pelo tipo", { type: "system" }],
    ["evento de sistema pelos metadados", { metadata: { system_event: true } }],
    ["tipo não suportado", { type: "location" }],
  ])("não mostra o botão para mensagem %s", (_label, overrides) => {
    render(<MessageBubble message={msg(overrides as Partial<Message>)} onEncaminhar={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Encaminhar esta mensagem" })).not.toBeInTheDocument();
  });

  it("mostra o selo quando a mensagem foi encaminhada", () => {
    render(<MessageBubble message={msg({ metadata: { forwarded: true } })} />);
    expect(screen.getByText("Encaminhada")).toBeInTheDocument();
  });
});

describe("MessageBubble — copiar e saltar na citação", () => {
  it("copia o corpo pelo helper de clipboard", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(<MessageBubble message={msg({ body: "copiar exatamente isto" })} />);
    fireEvent.click(screen.getByRole("button", { name: "Copiar mensagem" }));
    expect(writeText).toHaveBeenCalledWith("copiar exatamente isto");
    expect(await screen.findByText("Mensagem copiada.", { selector: "span" })).toBeInTheDocument();
  });

  it("citação clicável usa o mesmo salto por id mesmo fora da página", () => {
    const onGoToMessage = vi.fn();
    render(
      <MessageBubble
        message={msg({ reply_to_message_id: "message-outside-first-page" })}
        onGoToMessage={onGoToMessage}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Ir para a mensagem citada" }));
    expect(onGoToMessage).toHaveBeenCalledWith("message-outside-first-page");
  });
});
describe("MessageBubble, estrela pessoal", () => {
  it("mantém a ação visível para toque e alterna a mensagem", () => {
    const onToggleStar = vi.fn();
    render(<MessageBubble message={msg()} onToggleStar={onToggleStar} />);
    const botao = screen.getByRole("button", { name: "Favoritar mensagem" });
    expect(botao.className).toContain("opacity-100");
    fireEvent.click(botao);
    expect(onToggleStar).toHaveBeenCalledWith(expect.objectContaining({ id: "m1" }));
  });

  it("mostra o indicador e a ação de remover quando já está favoritada", () => {
    render(
      <MessageBubble
        message={msg({ starred_at: "2026-11-07T10:00:00.000Z" })}
        onToggleStar={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Remover mensagem das favoritas" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByLabelText("Mensagem favorita")).toBeInTheDocument();
  });
});
