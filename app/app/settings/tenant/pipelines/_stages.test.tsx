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
import { render, screen, waitFor, within } from "@testing-library/react";
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
  contagemDeNegocios,
  destinosPossiveis,
  papelDaEtapa,
  patchDePapel,
  ROTULO_DO_PAPEL,
  vizinhoAoMover,
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

/** Abre o menu «…» de uma etapa e escolhe uma ação pelo `data-testid`. */
async function noMenu(user: ReturnType<typeof userEvent.setup>, id: string, acao: string) {
  await user.click(screen.getByTestId(`menu-${id}`));
  await user.click(await screen.findByTestId(acao));
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

describe("contagemDeNegocios — a tela recompõe a frase, então pluraliza", () => {
  it("um negócio não vira «1 negócios»", () => {
    expect(contagemDeNegocios(1)).toBe("1 negócio");
  });

  it("zero e muitos ficam no plural", () => {
    expect(contagemDeNegocios(0)).toBe("0 negócios");
    expect(contagemDeNegocios(38)).toBe("38 negócios");
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

describe("StagesSection — a linha se explica sozinha", () => {
  /**
   * ⭐ A VERSÃO ANTERIOR ERA UMA TABELA, e dentro da janela lateral do quadro
   * (≈ 380 a 576 px) o nome da etapa encolhia até sumir atrás de um cabeçalho
   * de seis linhas e de um seletor «Nada especial». O que a linha precisa
   * mostrar é: o NOME inteiro, num campo; o papel como selo só em quem tem; e
   * as ações num menu que não empurra o nome. Sem cabeçalho de colunas: ele
   * não sobrevive a contêiner estreito.
   */
  it("mostra o nome inteiro num campo editável e o papel como selo só em quem tem", async () => {
    montar();
    await screen.findByTestId("nome-e1");

    expect(screen.getByTestId("nome-e1")).toHaveValue("Carrinho abandonado");
    expect(screen.getByTestId("nome-e2")).toHaveValue("Aguardando pagamento");

    // Selo em linguagem simples, e só onde há papel: a maioria das colunas
    // não tem nada a dizer, e um seletor por linha era ruído.
    expect(screen.getByTestId("papel-e3")).toHaveTextContent(ROTULO_DO_PAPEL.won);
    expect(screen.getByTestId("papel-e4")).toHaveTextContent(ROTULO_DO_PAPEL.lost);
    expect(screen.queryByTestId("papel-e1")).not.toBeInTheDocument();
    expect(screen.queryByText("Nada especial")).not.toBeInTheDocument();

    // Nenhum cabeçalho de tabela para quebrar.
    expect(screen.queryByTestId("etapas-cabecalho")).not.toBeInTheDocument();
  });

  it("o menu de cada etapa oferece marcar o papel e arquivar, com nomes acessíveis", async () => {
    const user = userEvent.setup();
    montar();
    await screen.findByTestId("nome-e1");

    expect(screen.getByTestId("menu-e1")).toHaveAccessibleName("Opções de «Carrinho abandonado»");
    expect(screen.getByTestId("subir-e1")).toHaveAccessibleName(
      "Mover «Carrinho abandonado» uma coluna para trás",
    );

    await user.click(screen.getByTestId("menu-e1"));
    const itens = (await screen.findAllByRole("menuitem")).map((i) => i.textContent?.trim());
    expect(itens).toEqual(["Marcar como venda fechada", "Marcar como perdido", "Arquivar etapa"]);
  });

  it("a etapa que já tem papel ganha «Tirar a marcação» e não pode ser marcada de novo", async () => {
    const user = userEvent.setup();
    montar();
    await screen.findByTestId("nome-e1");

    await user.click(screen.getByTestId("menu-e3"));
    expect(await screen.findByTestId("marcar-won-e3")).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByTestId("marcar-lost-e3")).not.toHaveAttribute("aria-disabled", "true");
    expect(screen.getByTestId("desmarcar-e3")).toBeInTheDocument();
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

describe("StagesSection — a marcação de fechamento", () => {
  it("avisa CITANDO A ETAPA que perde a marcação, e não envia antes de confirmar", async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.patch).mockResolvedValue({ data: { etapas: [] } });
    montar();
    await screen.findByTestId("nome-e1");

    await noMenu(user, "e2", "marcar-won-e2");

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

    await noMenu(user, "e2", "marcar-won-e2");
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

    await noMenu(user, "e2", "marcar-won-e2");

    // Nada a desmarcar: um aviso aqui seria falso ("desmarca «undefined»").
    expect(screen.queryByTestId("confirmar-papel-e2")).not.toBeInTheDocument();
    await waitFor(() => expect(apiClient.patch).toHaveBeenCalledTimes(1));
  });

  it("tirar a marcação: a recusa do servidor chega inteira e o selo não mente", async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.patch).mockRejectedValue(
      new ApiError(
        422,
        "unprocessable_entity",
        undefined,
        "r",
        "A etapa «Pago» é a etapa de ganho deste funil e o funil precisa de uma. Marque OUTRA etapa como de ganho — a marcação se muda, não se apaga.",
      ),
    );
    montar();
    await screen.findByTestId("nome-e1");

    await noMenu(user, "e3", "desmarcar-e3");

    expect(await screen.findByTestId("etapa-erro-e3")).toHaveTextContent(
      "a marcação se muda, não se apaga",
    );
    // O selo continua dizendo o que o BANCO tem — tirá-lo faria a tela afirmar
    // um estado que não existe.
    await waitFor(() =>
      expect(screen.getByTestId("papel-e3")).toHaveTextContent(ROTULO_DO_PAPEL.won),
    );
    // E releu o servidor: reenviar sobre um funil que mudou é o que o 409 pede
    // para evitar.
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledTimes(2));
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

describe("StagesSection — arquivar", () => {
  it("pede confirmação antes de tirar a coluna do quadro", async () => {
    const user = userEvent.setup();
    montar();
    await screen.findByTestId("nome-e1");

    await noMenu(user, "e1", "arquivar-e1");
    // Nada foi enviado só por clicar em «Arquivar»: uma coluna some do quadro
    // sem tela para desfazer.
    expect(apiClient.delete).not.toHaveBeenCalled();
    const painel = await screen.findByTestId("arquivar-painel-e1");
    expect(painel).toHaveTextContent("A coluna sai do quadro");
    // Honestidade: não existe tela que desarquive. Dizer isso ANTES é a
    // diferença entre uma escolha e uma armadilha.
    expect(painel).toHaveTextContent("não dá para trazer a coluna de volta por aqui");

    vi.mocked(apiClient.delete).mockResolvedValue({ data: { etapas: [] } });
    await user.click(screen.getByTestId("arquivar-confirmar-e1"));
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

    await noMenu(user, "e1", "arquivar-e1");
    await user.click(screen.getByTestId("arquivar-confirmar-e1"));

    expect(await screen.findByTestId("arquivar-pergunta-e1")).toHaveTextContent(
      "38 negócios estão nesta etapa. Para onde eles vão?",
    );
    // ⭐ Sem destino escolhido, arquivar NÃO é oferecido: perder o rastro de 38
    // negócios não pode ser um clique de distância.
    expect(screen.getByTestId("arquivar-confirmar-e1")).toBeDisabled();

    // ⭐ E o destino nunca inclui fechamento nem perda: mandar os negócios para
    // «Pago» os daria por vendidos, com data de fechamento.
    expect(await opcoesNaTela(user, "destino-e1")).toEqual(["Aguardando pagamento"]);
    await user.click(await screen.findByRole("option", { name: "Aguardando pagamento" }));

    vi.mocked(apiClient.delete).mockResolvedValue({ data: { etapas: [] } });
    await waitFor(() => expect(screen.getByTestId("arquivar-confirmar-e1")).toBeEnabled());
    await user.click(screen.getByTestId("arquivar-confirmar-e1"));

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

    await noMenu(user, "e1", "arquivar-e1");
    await user.click(screen.getByTestId("arquivar-confirmar-e1"));

    expect(await screen.findByTestId("arquivar-sem-destino-e1")).toHaveTextContent(
      "Crie uma etapa antes de arquivar «Carrinho abandonado»",
    );
    expect(screen.queryByTestId("destino-e1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("arquivar-confirmar-e1")).not.toBeInTheDocument();
  });

  /**
   * ⚠️ A ETAPA DE FECHAMENTO TEM NEGÓCIOS NA FIXTURE, E ISSO É O TESTE.
   *
   * Com `negocios: 0` este caso passava mesmo com a regra removida — a tela não
   * perguntava destino porque não havia negócio nenhum, não porque a etapa é a
   * de fechamento. Teste confundido: verde pelo motivo errado. «Pago» com 12
   * negócios fechados é o estado NORMAL de um funil em uso, e é aí que a
   * diferença aparece: sem a regra, a tela engole a explicação do servidor e
   * oferece mover 12 negócios fechados para outra coluna — operação que a API
   * recusaria de novo, deixando o usuário num laço sem explicação.
   */
  it("arquivar a etapa de fechamento COM negócios: explica, e não pergunta destino nenhum", async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.delete).mockRejectedValue(
      new ApiError(
        422,
        "unprocessable_entity",
        { negocios: 12, precisa_destino: false },
        "r",
        "«Pago» é a etapa de ganho deste funil. Marque OUTRA etapa como de ganho antes de arquivar esta — senão os negócios continuariam indo parar numa coluna fora do quadro.",
      ),
    );
    montar();
    await screen.findByTestId("nome-e1");

    await noMenu(user, "e3", "arquivar-e3");
    await user.click(screen.getByTestId("arquivar-confirmar-e3"));

    expect(await screen.findByTestId("arquivar-erro-e3")).toHaveTextContent(
      "Marque OUTRA etapa como de ganho antes de arquivar esta",
    );
    expect(screen.queryByTestId("destino-e3")).not.toBeInTheDocument();
    expect(screen.queryByTestId("arquivar-pergunta-e3")).not.toBeInTheDocument();
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

    await noMenu(user, "e2", "arquivar-e2");
    const aviso = await screen.findByTestId("arquivar-perde-passo-e2");
    expect(aviso).toHaveTextContent("assistente usa para «Em negociação»");
    expect(aviso).toHaveTextContent("para de mover o card nesse passo");
    expect(within(aviso).getByRole("link")).toHaveAttribute("href", `#mapeamento-${PIPE}`);
  });

  it("etapa sem vínculo com o assistente não ganha aviso que não se aplica", async () => {
    const user = userEvent.setup();
    montar();
    await screen.findByTestId("nome-e1");
    await noMenu(user, "e1", "arquivar-e1");
    await screen.findByTestId("arquivar-painel-e1");
    expect(screen.queryByTestId("arquivar-perde-passo-e1")).not.toBeInTheDocument();
  });

  it("com UM negócio a frase não vira «1 negócios estão»", async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.delete).mockRejectedValue(
      new ApiError(422, "unprocessable_entity", { negocios: 1, precisa_destino: true }, "r", "…tem 1 negócio…"),
    );
    montar();
    await screen.findByTestId("nome-e1");

    await noMenu(user, "e1", "arquivar-e1");
    await user.click(screen.getByTestId("arquivar-confirmar-e1"));
    const pergunta = await screen.findByTestId("arquivar-pergunta-e1");
    expect(pergunta).toHaveTextContent("1 negócio está nesta etapa. Para onde ele vai?");
    expect(pergunta).not.toHaveTextContent("1 negócios");
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

    await noMenu(user, "e1", "arquivar-e1");
    await user.click(screen.getByTestId("arquivar-confirmar-e1"));
    expect(await screen.findByTestId("arquivar-erro-e1")).toHaveTextContent("mudou de papel");
    expect(screen.queryByTestId("arquivar-pergunta-e1")).not.toBeInTheDocument();
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

    await noMenu(user, "e1", "arquivar-e1");
    await user.click(screen.getByTestId("arquivar-confirmar-e1"));

    const aviso = await screen.findByTestId("arquivar-erro-e1");
    expect(aviso).not.toHaveTextContent("violates");
    expect(aviso).not.toHaveTextContent("crm_leads");
    expect(aviso).toHaveTextContent("Não deu para salvar");
  });
});
