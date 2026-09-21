/**
 * A tela das etapas do funil — o que ela OFERECE, o que ela ENVIA e o que ela
 * pergunta ANTES de mandar.
 *
 * O que estes testes medem é só o que nasce aqui, na tela: as regras de verdade
 * (quem pode ser destino, quem pode perder a marcação, quem pode ser arquivada)
 * são da API e já têm 75 testes próprios. O que não pode falhar deste lado é
 * (a) não OFERECER o que a API recusaria — em especial mandar negócios para a
 * etapa de fechamento, que os daria por vendidos; (b) avisar CITANDO O NOME
 * antes de mover a marcação; (c) nunca deixar arquivar uma etapa com negócios
 * sem dizer para onde eles vão; e (d) reler o servidor depois de tudo.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { ApiError } from "@/lib/api/types";
import type { EstadoDoMapeamento, EtapaDoFunil } from "@/hooks/pipelines/useAgentMapping";

vi.mock("@/lib/api/client", () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

import { apiClient } from "@/lib/api/client";
import {
  StagesSection,
  contagemDeLeads,
  destinosPossiveis,
  moverNaLista,
  papelDaEtapa,
  patchDePapel,
  DESCRICAO_DO_PAPEL,
  ROTULO_DO_PAPEL,
  vizinhoAoMover,
  vizinhoAoSoltar,
} from "./_stages";

// Polyfills que o Radix Select exige e o jsdom não tem.
window.HTMLElement.prototype.scrollIntoView = vi.fn();
window.HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
window.HTMLElement.prototype.setPointerCapture = vi.fn();
window.HTMLElement.prototype.releasePointerCapture = vi.fn();
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const PIPE = "11111111-1111-4111-8111-111111111111";

/** O funil que o gatilho semeia — o que a clínica vê no primeiro login, encurtado. */
const ETAPAS: EtapaDoFunil[] = [
  { id: "e1", name: "Carrinho abandonado", is_won: false, is_lost: false },
  { id: "e2", name: "Aguardando pagamento", is_won: false, is_lost: false },
  { id: "e3", name: "Pago", is_won: true, is_lost: false },
  { id: "e4", name: "Cancelado", is_won: false, is_lost: true },
];

const VAZIO = {
  new: null,
  contacted: null,
  qualifying: null,
  qualified: null,
  negotiating: null,
  won: null,
  lost: null,
};

function estado(
  over: Partial<EstadoDoMapeamento["mapeamento"]> = {},
  etapas: EtapaDoFunil[] = ETAPAS,
): EstadoDoMapeamento {
  return { etapas, mapeamento: { ...VAZIO, ...over } };
}

function montar() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <StagesSection pipelineId={PIPE} ancoraMapeamento={`mapeamento-${PIPE}`} />
    </QueryClientProvider>,
  );
}

/** Abre um seletor e devolve os rótulos oferecidos. */
async function opcoesNaTela(user: ReturnType<typeof userEvent.setup>, testid: string) {
  await user.click(screen.getByTestId(testid));
  const lista = await screen.findByRole("listbox");
  return within(lista)
    .getAllByRole("option")
    .map((o) => o.textContent);
}

/** Abre o seletor de tipo de uma etapa e escolhe um papel. */
async function escolherTipo(
  user: ReturnType<typeof userEvent.setup>,
  id: string,
  papel: "nenhum" | "won" | "lost",
) {
  await user.click(screen.getByTestId(`tipo-${id}`));
  await user.click(await screen.findByTestId(`tipo-${papel}-${id}`));
}

/** Clica na lixeira da etapa: abre o painel de exclusão, não envia nada ainda. */
async function excluir(user: ReturnType<typeof userEvent.setup>, id: string) {
  await user.click(screen.getByTestId(`excluir-${id}`));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(apiClient.get).mockResolvedValue({ data: estado() });
});

describe("patchDePapel — só o que muda viaja", () => {
  it("marcar fechamento numa etapa comum manda só is_won", () => {
    expect(patchDePapel(ETAPAS[0]!, "won")).toEqual({ is_won: true });
  });

  it("marcar fechamento na etapa de PERDA solta o papel antigo junto", () => {
    // Sem `is_lost: false` o pedido seria "ganho e perda ao mesmo tempo" e a API
    // recusaria — o usuário veria um erro sobre uma combinação que ele nunca
    // pediu. (A API ainda recusa por outro motivo, e é ela que explica.)
    expect(patchDePapel(ETAPAS[3]!, "won")).toEqual({ is_won: true, is_lost: false });
  });

  it("«nada especial» numa etapa comum não gera pedido nenhum", () => {
    // Um PATCH vazio seria 422 «Nada para alterar» — erro na cara de quem
    // reabriu a lista e escolheu o que já estava lá.
    expect(patchDePapel(ETAPAS[0]!, "nenhum")).toEqual({});
  });

  it("«nada especial» na etapa de fechamento pede a desmarcação (e a API recusa)", () => {
    expect(patchDePapel(ETAPAS[2]!, "nenhum")).toEqual({ is_won: false });
    expect(papelDaEtapa(ETAPAS[2]!)).toBe("won");
  });
});

describe("destinosPossiveis — para onde os negócios podem ir", () => {
  it("exclui a própria etapa, a de fechamento e a de perda", () => {
    expect(destinosPossiveis(ETAPAS, "e1").map((e) => e.id)).toEqual(["e2"]);
  });

  it("funil sem etapa comum sobrando não oferece destino nenhum", () => {
    expect(destinosPossiveis([ETAPAS[0]!, ETAPAS[2]!, ETAPAS[3]!], "e1")).toEqual([]);
  });

  /**
   * ⚠️ AS DUAS METADES SEPARADAS, de propósito. Os testes acima morrem se
   * `!is_won && !is_lost` sair inteiro — e sobrevivem a quem remover só um dos
   * dois. São defeitos diferentes: mandar negócios para a etapa de GANHO os
   * marca vendidos com data de fechamento (`fn_crm_lead_close_on_stage`); para a
   * de PERDA, `fn_validate_lost_reason_required` levanta `22023` e o texto do
   * Postgres chega à tela.
   */
  it("a etapa de PERDA sozinha já é excluída", () => {
    const semGanho = [ETAPAS[0]!, ETAPAS[1]!, ETAPAS[3]!];
    expect(destinosPossiveis(semGanho, "e1").map((e) => e.id)).toEqual(["e2"]);
  });

  it("a etapa de GANHO sozinha já é excluída", () => {
    const semPerda = [ETAPAS[0]!, ETAPAS[1]!, ETAPAS[2]!];
    expect(destinosPossiveis(semPerda, "e1").map((e) => e.id)).toEqual(["e2"]);
  });
});

describe("contagemDeLeads — a tela recompõe a frase, então pluraliza", () => {
  it("um lead não vira «1 leads»", () => {
    expect(contagemDeLeads(1)).toBe("1 lead");
  });

  it("zero e muitos ficam no plural", () => {
    expect(contagemDeLeads(0)).toBe("0 leads");
    expect(contagemDeLeads(38)).toBe("38 leads");
  });
});

describe("vizinhoAoMover — a coluna da esquerda depois do passo", () => {
  it("subir a terceira coluna a deixa depois da PRIMEIRA", () => {
    expect(vizinhoAoMover(ETAPAS, 2, "subir")).toBe("e1");
  });

  it("subir a segunda coluna a deixa em primeiro (sem vizinha à esquerda)", () => {
    expect(vizinhoAoMover(ETAPAS, 1, "subir")).toBeNull();
  });

  it("descer a primeira coluna a deixa depois da segunda", () => {
    expect(vizinhoAoMover(ETAPAS, 0, "descer")).toBe("e2");
  });
});

/**
 * ⭐ ARRASTAR É UMA CHAMADA SÓ. Soltar a linha em qualquer lugar vira o mesmo
 * `depois_de` das setas, calculado a partir de onde ela saiu e onde caiu, nos
 * índices da lista ANTES de mover. Descendo e subindo o vizinho é outro: quem
 * ocupa o destino sobe uma casa quando a linha desce, e fica onde está quando
 * ela sobe.
 */
describe("vizinhoAoSoltar — a coluna da esquerda de onde a linha caiu", () => {
  it("arrastar a primeira para a terceira posição a deixa depois da que ERA a terceira", () => {
    // [a b c d] → [b c a d]: à esquerda de «a» está «c».
    expect(vizinhoAoSoltar(ETAPAS, 0, 2)).toBe("e3");
  });

  it("arrastar a última para a segunda posição a deixa depois da primeira", () => {
    // [a b c d] → [a d b c]: à esquerda de «d» está «a».
    expect(vizinhoAoSoltar(ETAPAS, 3, 1)).toBe("e1");
  });

  it("soltar no topo é «primeira coluna» (null), de onde quer que tenha vindo", () => {
    expect(vizinhoAoSoltar(ETAPAS, 2, 0)).toBeNull();
    expect(vizinhoAoSoltar(ETAPAS, 3, 0)).toBeNull();
  });

  it("soltar no fim deixa a linha depois da que era a última", () => {
    expect(vizinhoAoSoltar(ETAPAS, 0, 3)).toBe("e4");
  });

  it("uma casa para cima ou para baixo bate com as setas", () => {
    expect(vizinhoAoSoltar(ETAPAS, 2, 1)).toBe(vizinhoAoMover(ETAPAS, 2, "subir"));
    expect(vizinhoAoSoltar(ETAPAS, 0, 1)).toBe(vizinhoAoMover(ETAPAS, 0, "descer"));
  });
});

describe("moverNaLista — a ordem que a tela mostra antes do servidor responder", () => {
  it("move sem mexer na lista original", () => {
    const ids = (l: EtapaDoFunil[]) => l.map((e) => e.id);
    expect(ids(moverNaLista(ETAPAS, 0, 2))).toEqual(["e2", "e3", "e1", "e4"]);
    expect(ids(moverNaLista(ETAPAS, 3, 1))).toEqual(["e1", "e4", "e2", "e3"]);
    expect(ids(ETAPAS)).toEqual(["e1", "e2", "e3", "e4"]);
  });

  it("a ordem otimista e o vizinho enviado contam a mesma história", () => {
    // Para todo par (origem, destino): na lista movida, quem está imediatamente
    // à esquerda da etapa movida é exatamente o `depois_de` que vai ao servidor.
    for (let origem = 0; origem < ETAPAS.length; origem++) {
      for (let destino = 0; destino < ETAPAS.length; destino++) {
        const movida = moverNaLista(ETAPAS, origem, destino);
        const esquerda = movida[destino - 1]?.id ?? null;
        expect(vizinhoAoSoltar(ETAPAS, origem, destino)).toBe(esquerda);
      }
    }
  });
});

describe("StagesSection — a linha se explica sozinha", () => {
  /**
   * ⭐ A VERSÃO ANTERIOR ESCONDIA AS AÇÕES NUM MENU «…» com três itens que não
   * diziam para que serviam ("esse menu aí não tem pé nem cabeça, e também não
   * tem opção de excluir"). Agora cada linha mostra, sem clicar em nada: a alça
   * de arrastar, o NOME num campo, o TIPO num seletor que explica o que a
   * marcação faz, e a lixeira. Nada de menu, nada de cabeçalho de tabela (ele
   * não sobrevive ao contêiner estreito da janela lateral).
   */
  it("mostra alça, nome editável, tipo e lixeira em cada linha, sem menu", async () => {
    montar();
    await screen.findByTestId("nome-e1");

    expect(screen.getByTestId("nome-e1")).toHaveValue("Carrinho abandonado");
    expect(screen.getByTestId("nome-e2")).toHaveValue("Aguardando pagamento");

    expect(screen.getByTestId("alca-e1")).toHaveAccessibleName("Arrastar «Carrinho abandonado»");
    expect(screen.getByTestId("alca-e1").closest("[title]")).toHaveAttribute(
      "title",
      "Segure e arraste para mudar a ordem",
    );
    expect(screen.getByTestId("tipo-e1")).toHaveAccessibleName("Tipo da etapa «Carrinho abandonado»");
    expect(screen.getByTestId("excluir-e1")).toHaveAccessibleName("Excluir «Carrinho abandonado»");
    expect(screen.getByTestId("subir-e1")).toHaveAccessibleName(
      "Mover «Carrinho abandonado» uma coluna para trás",
    );

    // O tipo, fechado, diz em uma ou duas palavras o que a etapa é.
    expect(screen.getByTestId("tipo-e1")).toHaveTextContent(ROTULO_DO_PAPEL.nenhum);
    expect(screen.getByTestId("tipo-e3")).toHaveTextContent(ROTULO_DO_PAPEL.won);
    expect(screen.getByTestId("tipo-e4")).toHaveTextContent(ROTULO_DO_PAPEL.lost);

    expect(screen.queryByTestId("menu-e1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("etapas-cabecalho")).not.toBeInTheDocument();
  });

  it("o subtítulo diz o que dá para fazer: arrastar, renomear, tipo e excluir", async () => {
    montar();
    const guia = await screen.findByTestId("etapas-como-usar");
    expect(guia).toHaveTextContent("Arraste pela alça para mudar a ordem");
    expect(guia).toHaveTextContent("clique no nome para renomear");
    expect(guia).toHaveTextContent("escolha o tipo de cada etapa");
    expect(guia).toHaveTextContent("exclua as que não usa");
  });

  it("o seletor de tipo explica, em linguagem de dono, o que cada marcação faz", async () => {
    const user = userEvent.setup();
    montar();
    await screen.findByTestId("nome-e1");

    expect(await opcoesNaTela(user, "tipo-e1")).toEqual([
      DESCRICAO_DO_PAPEL.nenhum,
      DESCRICAO_DO_PAPEL.won,
      DESCRICAO_DO_PAPEL.lost,
    ]);
    expect(DESCRICAO_DO_PAPEL.won).toBe("Venda fechada (aqui o lead vira cliente)");
    expect(DESCRICAO_DO_PAPEL.lost).toBe("Perdido (aqui o lead desistiu)");
  });

  /**
   * ⭐ VOLTAR A «ETAPA NORMAL» NÃO EXISTE (o servidor recusa: o funil precisa de
   * uma etapa de venda e uma de perda), então a opção fica desabilitada e a dica
   * diz o único caminho que funciona: marcar OUTRA etapa.
   */
  it("a etapa que já tem papel não oferece voltar a normal, e a dica diz o caminho", async () => {
    const user = userEvent.setup();
    montar();
    await screen.findByTestId("nome-e1");

    expect(screen.getByTestId("tipo-e3").closest("[title]")).toHaveAttribute(
      "title",
      "Para mudar, escolha Venda fechada em outra etapa.",
    );
    expect(screen.getByTestId("tipo-e4").closest("[title]")).toHaveAttribute(
      "title",
      "Para mudar, escolha Perdido em outra etapa.",
    );
    // A etapa comum não carrega dica: dica sem motivo é ruído.
    expect(screen.getByTestId("tipo-e1").closest("[title]")).toBeNull();

    await user.click(screen.getByTestId("tipo-e3"));
    expect(await screen.findByTestId("tipo-nenhum-e3")).toHaveAttribute("data-disabled");
    expect(screen.getByTestId("tipo-lost-e3")).not.toHaveAttribute("data-disabled");
  });

  it("venda fechada e perdido não podem ser excluídas, e o botão diz por quê", async () => {
    montar();
    await screen.findByTestId("nome-e1");

    expect(screen.getByTestId("excluir-e3")).toBeDisabled();
    expect(screen.getByTestId("excluir-e4")).toBeDisabled();
    expect(screen.getByTestId("excluir-e3").closest("[title]")).toHaveAttribute(
      "title",
      "Etapas de venda fechada e perdido não podem ser excluídas: o funil precisa de uma de cada.",
    );
    expect(screen.getByTestId("excluir-e1")).toBeEnabled();
    expect(screen.getByTestId("excluir-e1").closest("[title]")).toBeNull();
  });

  it("seta que não pode mover explica por quê", async () => {
    montar();
    await screen.findByTestId("nome-e1");

    expect(screen.getByTestId("subir-e1").closest("[title]")).toHaveAttribute(
      "title",
      "Já é a primeira etapa",
    );
    expect(screen.getByTestId("descer-e4").closest("[title]")).toHaveAttribute(
      "title",
      "Já é a última etapa",
    );
    // A seta que PODE mover não carrega dica nenhuma: dica sem motivo é ruído.
    expect(screen.getByTestId("descer-e1").closest("[title]")).toBeNull();
  });
});

describe("StagesSection — renomear, criar e reordenar", () => {
  it("renomear salva ao CONFIRMAR, nunca a cada tecla", async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.patch).mockResolvedValue({ data: { etapas: [] } });
    montar();
    const campo = await screen.findByTestId("nome-e1");

    await user.clear(campo);
    await user.type(campo, "Primeira consulta");
    // Cinco letras digitadas, zero PATCH: um por tecla gravaria "P", "Pr", "Pri"…
    expect(apiClient.patch).not.toHaveBeenCalled();

    await user.tab();
    await waitFor(() => expect(apiClient.patch).toHaveBeenCalledTimes(1));
    expect(vi.mocked(apiClient.patch).mock.calls[0]).toEqual([
      `/api/v1/pipelines/${PIPE}/stages/e1`,
      { name: "Primeira consulta" },
    ]);
    // Feedback discreto ao lado do campo, onde o olho já está.
    expect(await screen.findByTestId("salvo-e1")).toHaveTextContent("Salvo");
  });

  it("sair do campo sem mudar nada não manda pedido nenhum", async () => {
    const user = userEvent.setup();
    montar();
    const campo = await screen.findByTestId("nome-e1");
    await user.click(campo);
    await user.tab();
    expect(apiClient.patch).not.toHaveBeenCalled();
  });

  it("acrescentar etapa manda o nome para o fim do funil e relê", async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.post).mockResolvedValue({ data: { etapas: [] } });
    montar();
    await screen.findByTestId("nome-e1");

    // O campo está sempre à vista no fim da lista: não há botão para "abrir".
    await user.type(screen.getByTestId("nova-etapa-nome"), "Retorno");
    await user.click(screen.getByTestId("nova-etapa-criar"));

    await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(1));
    expect(vi.mocked(apiClient.post).mock.calls[0]).toEqual([
      `/api/v1/pipelines/${PIPE}/stages`,
      { name: "Retorno" },
    ]);
    // Releitura: a etapa nova precisa aparecer sem F5.
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledTimes(2));
  });

  it("subir uma coluna manda a VIZINHA DA ESQUERDA, não um número de posição", async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.patch).mockResolvedValue({ data: { etapas: [] } });
    montar();
    await screen.findByTestId("nome-e1");

    await user.click(screen.getByTestId("subir-e3"));
    await waitFor(() => expect(apiClient.patch).toHaveBeenCalledTimes(1));
    expect(vi.mocked(apiClient.patch).mock.calls[0]![1]).toEqual({ depois_de: "e1" });
  });

  it("a primeira coluna não sobe e a última não desce", async () => {
    montar();
    await screen.findByTestId("nome-e1");
    expect(screen.getByTestId("subir-e1")).toBeDisabled();
    expect(screen.getByTestId("descer-e4")).toBeDisabled();
    expect(screen.getByTestId("descer-e1")).toBeEnabled();
  });
});

/**
 * ⭐ ARRASTAR DE VERDADE, pelo caminho que o jsdom permite: o teclado. A alça
 * responde a espaço (pegar), setas (mover) e espaço (soltar) pela mesma
 * biblioteca que trata o mouse, e o `onDragEnd` é o mesmo. O jsdom não mede
 * nada, então cada linha ganha uma altura fingida (50px) para a biblioteca
 * saber que "uma seta para baixo" cruza a linha de baixo.
 */
describe("StagesSection — arrastar pela alça", () => {
  const ALTURA = 50;

  function medidas() {
    const rect = (top: number, height: number) =>
      ({
        x: 0,
        y: top,
        top,
        left: 0,
        right: 600,
        bottom: top + height,
        width: 600,
        height,
        toJSON() {},
      }) as DOMRect;
    return vi
      .spyOn(Element.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: Element) {
        if (this.tagName === "UL" && this.hasAttribute("data-rfd-droppable-id")) {
          return rect(0, ALTURA * this.children.length);
        }
        if (this.tagName === "LI" && this.hasAttribute("data-rfd-draggable-id")) {
          const i = Array.from(this.parentElement?.children ?? []).indexOf(this);
          return rect(i * ALTURA, ALTURA);
        }
        return rect(0, 0);
      });
  }

  /**
   * Espaço na alça pega, uma seta move uma casa, espaço solta. A biblioteca só
   * olha `keyCode` (32, 38, 40), que o `user-event` não preenche, daí o
   * `fireEvent` com os códigos à mão; entre um passo e outro ela agenda o
   * próximo quadro, então cada tecla espera um tique. Depois de pegar, a linha
   * original sai do DOM (o clone é que segue o mouse), então as teclas
   * seguintes vão para o `window`, que é onde a biblioteca escuta.
   */
  async function arrastarPeloTeclado(id: string, seta: "baixo" | "cima", casas: number) {
    const alca = screen.getByTestId(`alca-${id}`);
    const tique = () => new Promise((r) => setTimeout(r, 0));
    alca.focus();
    fireEvent.keyDown(alca, { key: " ", keyCode: 32 });
    await tique();
    for (let k = 0; k < casas; k++) {
      fireEvent.keyDown(window, seta === "baixo" ? { key: "ArrowDown", keyCode: 40 } : { key: "ArrowUp", keyCode: 38 });
      await tique();
    }
    fireEvent.keyDown(window, { key: " ", keyCode: 32 });
    await tique();
    // Soltar termina no `transitionend` da animação de queda, que o jsdom nunca
    // dispara; a biblioteca aceita um `scroll` como sinal para concluir.
    fireEvent.scroll(window);
    await tique();
  }

  const ordemNaTela = () =>
    screen.getAllByTestId(/^nome-e\d$/).map((campo) => (campo as HTMLInputElement).value);

  it("soltar a linha manda UMA chamada com a vizinha da esquerda da posição final, e a lista já muda", async () => {
    medidas();
    let responder: () => void = () => {};
    vi.mocked(apiClient.patch).mockReturnValue(
      new Promise((resolve) => {
        responder = () => resolve({ data: { etapas: [] } });
      }),
    );
    montar();
    await screen.findByTestId("nome-e1");

    // «Carrinho abandonado» desce duas casas: [e1 e2 e3 e4] → [e2 e3 e1 e4].
    await arrastarPeloTeclado("e1", "baixo", 2);

    await waitFor(() => expect(apiClient.patch).toHaveBeenCalledTimes(1));
    expect(vi.mocked(apiClient.patch).mock.calls[0]).toEqual([
      `/api/v1/pipelines/${PIPE}/stages/e1`,
      { depois_de: "e3" },
    ]);
    // Otimista: a ordem nova aparece ANTES de o servidor responder.
    expect(ordemNaTela()).toEqual(["Aguardando pagamento", "Pago", "Carrinho abandonado", "Cancelado"]);

    responder();
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledTimes(2));
  });

  it("se o servidor recusar, a ordem anterior volta e o motivo aparece na linha arrastada", async () => {
    medidas();
    vi.mocked(apiClient.patch).mockRejectedValue(
      new ApiError(409, "state_conflict", undefined, "r", "Este funil mudou enquanto você editava. Recarregue a página."),
    );
    montar();
    await screen.findByTestId("nome-e1");

    await arrastarPeloTeclado("e4", "cima", 3);
    await waitFor(() => expect(apiClient.patch).toHaveBeenCalledTimes(1));
    expect(vi.mocked(apiClient.patch).mock.calls[0]![1]).toEqual({ depois_de: null });

    const aviso = await screen.findByTestId("etapa-erro-e4");
    expect(aviso).toHaveTextContent("Recarregue a página");
    expect(ordemNaTela()).toEqual(["Carrinho abandonado", "Aguardando pagamento", "Pago", "Cancelado"]);
  });

  it("soltar no mesmo lugar não manda nada", async () => {
    medidas();
    montar();
    await screen.findByTestId("nome-e1");

    await arrastarPeloTeclado("e2", "baixo", 0);
    expect(apiClient.patch).not.toHaveBeenCalled();
  });
});

describe("StagesSection — a marcação de fechamento", () => {
  it("avisa CITANDO A ETAPA que perde a marcação, e não envia antes de confirmar", async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.patch).mockResolvedValue({ data: { etapas: [] } });
    montar();
    await screen.findByTestId("nome-e1");

    await escolherTipo(user, "e2", "won");

    const aviso = await screen.findByTestId("confirmar-papel-e2");
    // O nome, não um aviso genérico: «Pago» é a coluna que vai deixar de fechar.
    expect(aviso).toHaveTextContent("Só uma etapa pode ser a de venda fechada.");
    expect(aviso).toHaveTextContent("desmarca «Pago»");
    expect(apiClient.patch).not.toHaveBeenCalled();

    await user.click(screen.getByTestId("confirmar-papel-sim-e2"));
    await waitFor(() => expect(apiClient.patch).toHaveBeenCalledTimes(1));
    expect(vi.mocked(apiClient.patch).mock.calls[0]![1]).toEqual({ is_won: true });
  });

  it("cancelar o aviso não grava nada", async () => {
    const user = userEvent.setup();
    montar();
    await screen.findByTestId("nome-e1");

    await escolherTipo(user, "e2", "won");
    await user.click(within(await screen.findByTestId("confirmar-papel-e2")).getByText("Cancelar"));

    expect(screen.queryByTestId("confirmar-papel-e2")).not.toBeInTheDocument();
    expect(apiClient.patch).not.toHaveBeenCalled();
  });

  it("funil SEM etapa de fechamento não inventa aviso — marca direto", async () => {
    const user = userEvent.setup();
    const semGanho: EtapaDoFunil[] = [
      { id: "e1", name: "Primeiro contato", is_won: false, is_lost: false },
      { id: "e2", name: "Avaliação", is_won: false, is_lost: false },
    ];
    vi.mocked(apiClient.get).mockResolvedValue({ data: estado({}, semGanho) });
    vi.mocked(apiClient.patch).mockResolvedValue({ data: { etapas: [] } });
    montar();
    await screen.findByTestId("nome-e2");

    await escolherTipo(user, "e2", "won");

    // Nada a desmarcar: um aviso aqui seria falso ("desmarca «undefined»").
    expect(screen.queryByTestId("confirmar-papel-e2")).not.toBeInTheDocument();
    await waitFor(() => expect(apiClient.patch).toHaveBeenCalledTimes(1));
  });


  /**
   * ⭐ O LINK É SOBRE O ERRO, NÃO SOBRE A LINHA. Condicionado a "esta linha tem
   * passo", um nome duplicado produzia o non sequitur "Já existe uma etapa
   * chamada «Cancelado». Ir para o mapeamento do assistente."
   */
  it("recusa de NOME não oferece o mapeamento do assistente", async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.get).mockResolvedValue({ data: estado({ won: "e3" }) });
    vi.mocked(apiClient.patch).mockRejectedValue(
      new ApiError(422, "unprocessable_entity", undefined, "r", "Já existe uma etapa chamada «Cancelado» neste funil. Escolha outro nome."),
    );
    montar();
    const campo = await screen.findByTestId("nome-e3");
    await user.clear(campo);
    await user.type(campo, "Cancelado");
    await user.tab();

    const aviso = await screen.findByTestId("etapa-erro-e3");
    expect(aviso).toHaveTextContent("Escolha outro nome");
    expect(within(aviso).queryByRole("link")).toBeNull();
  });

  it("etapa que representa um passo do assistente oferece o caminho para desfazer o vínculo", async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: estado({ won: "e3" }) });
    montar();
    const linha = await screen.findByTestId("passo-de-e3");
    expect(linha).toHaveTextContent("O assistente usa esta etapa para «Ganho».");
    expect(within(linha).getByRole("link")).toHaveAttribute("href", `#mapeamento-${PIPE}`);
  });
});

describe("StagesSection — excluir (que por baixo é arquivar)", () => {
  it("pede confirmação antes de tirar a coluna do quadro", async () => {
    const user = userEvent.setup();
    montar();
    await screen.findByTestId("nome-e1");

    await excluir(user, "e1");
    // Nada foi enviado só por clicar na lixeira: uma coluna some do quadro
    // sem tela para desfazer.
    expect(apiClient.delete).not.toHaveBeenCalled();
    const painel = await screen.findByTestId("excluir-painel-e1");
    expect(painel).toHaveTextContent("Excluir a etapa «Carrinho abandonado»?");
    expect(painel).toHaveTextContent("os leads que estiverem nela vão para a etapa que você escolher");
    // Honestidade: não existe tela que desarquive. Dizer isso ANTES é a
    // diferença entre uma escolha e uma armadilha.
    expect(painel).toHaveTextContent("não dá para trazer a etapa de volta por aqui");

    vi.mocked(apiClient.delete).mockResolvedValue({ data: { etapas: [] } });
    await user.click(screen.getByTestId("excluir-confirmar-e1"));
    await waitFor(() => expect(apiClient.delete).toHaveBeenCalledTimes(1));
    expect(vi.mocked(apiClient.delete).mock.calls[0]![0]).toBe(
      `/api/v1/pipelines/${PIPE}/stages/e1`,
    );
  });

  it("com negócios: pergunta o destino com a CONTAGEM do servidor e não deixa arquivar sem ele", async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.delete).mockRejectedValueOnce(
      new ApiError(
        422,
        "unprocessable_entity",
        { negocios: 38, precisa_destino: true },
        "r",
        "A etapa «Carrinho abandonado» tem 38 negócios. Escolha para qual etapa eles vão antes de arquivá-la.",
      ),
    );
    montar();
    await screen.findByTestId("nome-e1");

    await excluir(user, "e1");
    await user.click(screen.getByTestId("excluir-confirmar-e1"));

    // A frase do dono, com o número do servidor: "Os N leads dela vão para a
    // etapa que você escolher."
    expect(await screen.findByTestId("excluir-pergunta-e1")).toHaveTextContent(
      "Excluir a etapa «Carrinho abandonado»? Os 38 leads dela vão para a etapa que você escolher.",
    );
    // ⭐ Sem destino escolhido, arquivar NÃO é oferecido: perder o rastro de 38
    // negócios não pode ser um clique de distância.
    expect(screen.getByTestId("excluir-confirmar-e1")).toBeDisabled();

    // ⭐ E o destino nunca inclui fechamento nem perda: mandar os negócios para
    // «Pago» os daria por vendidos, com data de fechamento.
    expect(await opcoesNaTela(user, "destino-e1")).toEqual(["Aguardando pagamento"]);
    await user.click(await screen.findByRole("option", { name: "Aguardando pagamento" }));

    vi.mocked(apiClient.delete).mockResolvedValue({ data: { etapas: [] } });
    await waitFor(() => expect(screen.getByTestId("excluir-confirmar-e1")).toBeEnabled());
    await user.click(screen.getByTestId("excluir-confirmar-e1"));

    await waitFor(() => expect(apiClient.delete).toHaveBeenCalledTimes(2));
    expect(vi.mocked(apiClient.delete).mock.calls[1]![0]).toBe(
      `/api/v1/pipelines/${PIPE}/stages/e1?destino=e2`,
    );
  });

  it("com negócios e SEM destino possível: diz o beco em vez de oferecer um seletor vazio", async () => {
    const user = userEvent.setup();
    const soDesfecho: EtapaDoFunil[] = [ETAPAS[0]!, ETAPAS[2]!, ETAPAS[3]!];
    vi.mocked(apiClient.get).mockResolvedValue({ data: estado({}, soDesfecho) });
    vi.mocked(apiClient.delete).mockRejectedValue(
      new ApiError(422, "unprocessable_entity", { negocios: 4, precisa_destino: true }, "r", "…tem 4 negócios…"),
    );
    montar();
    await screen.findByTestId("nome-e1");

    await excluir(user, "e1");
    await user.click(screen.getByTestId("excluir-confirmar-e1"));

    expect(await screen.findByTestId("excluir-sem-destino-e1")).toHaveTextContent(
      "4 leads estão nesta etapa e não há outra etapa normal para recebê-los. Crie uma etapa antes de excluir «Carrinho abandonado»",
    );
    expect(screen.queryByTestId("destino-e1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("excluir-confirmar-e1")).not.toBeInTheDocument();
  });

  /**
   * ⚠️ A ETAPA DE FECHAMENTO NEM ABRE O PAINEL. A versão anterior deixava
   * clicar, mandava o DELETE, e mostrava a recusa do servidor («Pago» é a etapa
   * de ganho, marque outra antes). Hoje a lixeira dessa linha é desabilitada com
   * a dica no lugar: a regra continua sendo da API (ela recusaria igual), mas
   * oferecer um botão que sempre falha é convidar ao erro. O que o servidor diz
   * numa recusa que NÃO pede destino continua coberto pelo caso do 409 abaixo.
   */
  it("a lixeira da etapa de fechamento não abre painel nem manda DELETE", async () => {
    const user = userEvent.setup();
    montar();
    await screen.findByTestId("nome-e1");

    const botao = screen.getByTestId("excluir-e3");
    expect(botao).toBeDisabled();
    await user.click(botao);
    expect(screen.queryByTestId("excluir-painel-e3")).not.toBeInTheDocument();
    expect(apiClient.delete).not.toHaveBeenCalled();
  });

  /**
   * ⭐ A SEGUNDA IRREVERSIBILIDADE. `validarArquivamento` recusa arquivar a etapa
   * de ganho/perda mas NÃO olha `agent_stage_hint`, e o DELETE não limpa o hint:
   * `resolveDestinoDoAgente` procura o alvo com `!is_archived`, então arquivar
   * desliga o passo do assistente em silêncio. A tela avisava sobre a coluna não
   * voltar e não dizia nada sobre isto.
   */
  it("⭐ avisa que arquivar desliga o passo do assistente — citando o passo", async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.get).mockResolvedValue({ data: estado({ negotiating: "e2" }) });
    montar();
    await screen.findByTestId("nome-e1");

    await excluir(user, "e2");
    const aviso = await screen.findByTestId("excluir-perde-passo-e2");
    expect(aviso).toHaveTextContent("assistente usa para «Em negociação»");
    expect(aviso).toHaveTextContent("para de mover o card nesse passo");
    expect(within(aviso).getByRole("link")).toHaveAttribute("href", `#mapeamento-${PIPE}`);
  });

  it("etapa sem vínculo com o assistente não ganha aviso que não se aplica", async () => {
    const user = userEvent.setup();
    montar();
    await screen.findByTestId("nome-e1");
    await excluir(user, "e1");
    await screen.findByTestId("excluir-painel-e1");
    expect(screen.queryByTestId("excluir-perde-passo-e1")).not.toBeInTheDocument();
  });

  it("com UM lead a frase não vira «Os 1 leads»", async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.delete).mockRejectedValue(
      new ApiError(422, "unprocessable_entity", { negocios: 1, precisa_destino: true }, "r", "…tem 1 negócio…"),
    );
    montar();
    await screen.findByTestId("nome-e1");

    await excluir(user, "e1");
    await user.click(screen.getByTestId("excluir-confirmar-e1"));
    const pergunta = await screen.findByTestId("excluir-pergunta-e1");
    expect(pergunta).toHaveTextContent(
      "Excluir a etapa «Carrinho abandonado»? O único lead dela vai para a etapa que você escolher.",
    );
    expect(pergunta).not.toHaveTextContent("1 leads");
  });

  /**
   * ⭐ A tela reage ao que o SERVIDOR disse, não ao que ela deduz. Uma recusa
   * NOVA sobre etapa comum com negócios (aqui: um 409 de concorrência) tem de
   * chegar ao usuário inteira — a versão anterior a trocava por "para onde eles
   * vão?" e o motivo real só aparecia um passo depois.
   */
  it("recusa que NÃO pede destino chega inteira, mesmo com negócios na etapa", async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.delete).mockRejectedValue(
      new ApiError(
        409,
        "state_conflict",
        { negocios: 7, precisa_destino: false },
        "r",
        "«Carrinho abandonado» mudou de papel neste funil enquanto você editava.",
      ),
    );
    montar();
    await screen.findByTestId("nome-e1");

    await excluir(user, "e1");
    await user.click(screen.getByTestId("excluir-confirmar-e1"));
    expect(await screen.findByTestId("excluir-erro-e1")).toHaveTextContent("mudou de papel");
    expect(screen.queryByTestId("excluir-pergunta-e1")).not.toBeInTheDocument();
  });

  it("erro 500 não vaza texto do Postgres para o dono da clínica", async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.delete).mockRejectedValue(
      new ApiError(
        500,
        "internal_error",
        undefined,
        "r",
        'update on table "crm_leads" violates foreign key constraint',
      ),
    );
    montar();
    await screen.findByTestId("nome-e1");

    await excluir(user, "e1");
    await user.click(screen.getByTestId("excluir-confirmar-e1"));

    const aviso = await screen.findByTestId("excluir-erro-e1");
    expect(aviso).not.toHaveTextContent("violates");
    expect(aviso).not.toHaveTextContent("crm_leads");
    expect(aviso).toHaveTextContent("Não deu para salvar");
  });
});
