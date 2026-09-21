"use client";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useAgentMapping,
  type EtapaDoFunil,
  type MapaDoAgente,
} from "@/hooks/pipelines/useAgentMapping";
import {
  useArquivarEtapa,
  useCriarEtapa,
  useEditarEtapa,
  type PatchDeEtapa,
} from "@/hooks/pipelines/useStages";
import { LEAD_STAGES, type LeadStage } from "@/lib/agent-engine/agent/lead-state";
import { ApiError } from "@/lib/api/types";
import { ROTULO_DO_PASSO } from "@/lib/leads/agent-mapping";
import { Archive, CaretDown, CaretUp, Check, DotsThree, Plus, Warning } from "@/lib/ui/icons";
import { SeloDeAutoria } from "@/components/operacao/SeloDeAutoria";
import { useT } from "@/hooks/i18n/useT";

import { mensagemDeErro } from "./_mapping";

/**
 * Onde o dono do negócio transforma o funil que veio de fábrica no funil dele.
 *
 * ⚠️ ESTA TELA EXISTE PORQUE O SISTEMA JÁ DECIDE POR QUEM INSTALA. O gatilho
 * `trg_seed_default_pipeline_for_org` semeia um funil de e-commerce em TODA
 * organização criada: uma clínica abre o produto e vê "Carrinho abandonado",
 * "Aguardando pagamento", "Em separacao". Até aqui não havia tela, rota nem
 * action que renomeasse, criasse ou tirasse uma etapa do quadro.
 *
 * ⚠️ AS REGRAS SÃO DA API; AQUI SÓ HÁ REFLEXO. Nada nesta tela recalcula o que
 * `lib/leads/stage-editing.ts` já decide: quando a operação é impossível, quem
 * diz é o servidor, e a frase dele (escrita para leigo, citando o nome da etapa)
 * vai inteira para a tela. O que a tela faz por conta própria é só o que ela
 * pode saber antes de perguntar: não OFERECER um destino que a API recusaria
 * (etapa de fechamento ou de perda receberia negócios e os daria por encerrados)
 * e avisar ANTES que marcar o fechamento aqui o tira de lá.
 *
 * ⚠️ ARQUIVAR É O ÚNICO "REMOVER" QUE EXISTE, e não é eufemismo:
 * `crm_leads_stage_id_fkey` é `ON DELETE RESTRICT`. O histórico dos negócios
 * aponta para a etapa e apagá-la levaria o histórico junto.
 *
 * ⚠️ A LISTA SE ADAPTA À LARGURA DO CONTÊINER, NÃO DA JANELA. Esta seção vive
 * em dois lugares: na página de configurações (larga) e numa janela lateral do
 * quadro (≈ 380 a 576 px). A primeira versão era uma tabela com cabeçalho e
 * larguras por `sm:`; dentro da janela o navegador é largo, o contêiner é
 * estreito, e o nome da etapa encolhia até sumir. Daí `@container` e `@md:`.
 */

/** A âncora desta seção. O mapeamento linka para cá quando aponta uma lacuna do funil. */
export const ancoraDasEtapas = (pipelineId: string) => `etapas-${pipelineId}`;

/** O papel de uma etapa no desfecho do negócio. `nenhum` é a maioria das colunas. */
export type Papel = "nenhum" | "won" | "lost";

/**
 * O selo que a etapa carrega ao lado do nome. Só quem tem papel especial
 * ganha selo: a maioria das colunas não tem nada a dizer, e um seletor
 * dizendo "Nada especial" em toda linha era ruído que escondia o nome.
 */
export const ROTULO_DO_PAPEL: Readonly<Record<Exclude<Papel, "nenhum">, string>> = {
  won: "Venda fechada",
  lost: "Perdido",
};

export function papelDaEtapa(etapa: EtapaDoFunil): Papel {
  if (etapa.is_won) return "won";
  if (etapa.is_lost) return "lost";
  return "nenhum";
}

/**
 * O papel escolhido traduzido no corpo do PATCH.
 *
 * ⚠️ SÓ O QUE MUDA VIAJA. Mandar `is_lost: false` numa etapa que já não é de
 * perda faria a API validar uma desmarcação que ninguém pediu, e ela recusa
 * desmarcação (o funil precisa de uma etapa de perda). O campo do papel que a
 * etapa ABANDONA entra de propósito: sem ele, virar a etapa de perda em etapa de
 * fechamento pediria "ganho e perda ao mesmo tempo".
 */
export function patchDePapel(etapa: EtapaDoFunil, papel: Papel): PatchDeEtapa {
  const patch: PatchDeEtapa = {};
  const querWon = papel === "won";
  const querLost = papel === "lost";
  if (etapa.is_won !== querWon) patch.is_won = querWon;
  if (etapa.is_lost !== querLost) patch.is_lost = querLost;
  return patch;
}

/**
 * As etapas que podem receber os negócios de uma que está sendo arquivada.
 *
 * ⚠️ FECHAMENTO E PERDA FICAM DE FORA, e o motivo é grave o bastante para não
 * ser detalhe de lista: `fn_crm_lead_close_on_stage` fecha o negócio pelo
 * estágio. Mandar N negócios para a etapa de fechamento os marcaria como
 * vendidos, com data de fechamento: receita mexida por alguém arrumando o
 * quadro. A API recusa; a tela nem oferece, porque oferecer é convidar ao erro.
 */
export function destinosPossiveis(etapas: EtapaDoFunil[], etapaId: string): EtapaDoFunil[] {
  return etapas.filter((e) => e.id !== etapaId && !e.is_won && !e.is_lost);
}

/**
 * O vizinho da ESQUERDA depois de mover a etapa uma casa (`null` = primeira coluna).
 *
 * É o que o PATCH espera: quem clica na seta sabe onde a coluna vai parar, não
 * qual fração de `position` isso vira. Subir uma casa é "passar a ficar depois
 * de quem estava DUAS casas atrás", daí o `i - 2`.
 */
export function vizinhoAoMover(
  etapas: EtapaDoFunil[],
  i: number,
  direcao: "subir" | "descer",
): string | null {
  if (direcao === "subir") return etapas[i - 2]?.id ?? null;
  return etapas[i + 1]?.id ?? null;
}

/** Passo do assistente que cada etapa representa: `mapeamento` do avesso. */
function passoPorEtapa(mapa: MapaDoAgente): Map<string, LeadStage> {
  const m = new Map<string, LeadStage>();
  for (const passo of LEAD_STAGES) {
    const id = mapa[passo];
    if (id) m.set(id, passo);
  }
  return m;
}

/** "1 negócio", "4 negócios": a tela recompõe a frase, então pluraliza como o servidor. */
export function contagemDeNegocios(
  n: number,
  t: (texto: string) => string = (texto) => texto,
): string {
  return `${n} ${n === 1 ? t("negócio") : t("negócios")}`;
}

/**
 * O que o 422 do arquivamento diz sobre o caso: contagem e QUAL regra recusou.
 *
 * ⚠️ `precisaDestino` VEM DO SERVIDOR, não é re-derivado aqui. A tela troca essa
 * recusa específica por uma pergunta; decidir isso por conta própria ("tem
 * negócio e não é de ganho/perda") faria qualquer recusa NOVA sobre uma etapa
 * comum com negócios sumir atrás da pergunta.
 */
function casoDoErro(e: unknown): { negocios: number | null; precisaDestino: boolean } {
  const d = e instanceof ApiError ? (e.details as Record<string, unknown> | undefined) : undefined;
  return {
    negocios: typeof d?.negocios === "number" ? d.negocios : null,
    precisaDestino: d?.precisa_destino === true,
  };
}

/** O que o painel de arquivamento está esperando do usuário. */
type Arquivamento = {
  etapaId: string;
  /** `null` enquanto a tela ainda não perguntou ao servidor quantos negócios há. */
  negocios: number | null;
  destino: string | null;
  erro: string | null;
};

/** Quanto tempo o "Salvo" fica ao lado do nome depois de gravar. */
const DURACAO_DO_SALVO_MS = 2000;

export function StagesSection({
  pipelineId,
  ancoraMapeamento,
}: {
  pipelineId: string;
  /** Para onde mandar quem precisa desfazer o vínculo de uma etapa com o assistente. */
  ancoraMapeamento: string;
}) {
  const t = useT();
  const consulta = useAgentMapping(pipelineId);
  const criar = useCriarEtapa(pipelineId);
  const editar = useEditarEtapa(pipelineId);
  const arquivar = useArquivarEtapa(pipelineId);

  const [erro, setErro] = useState<
    { etapaId: string | null; texto: string; sobrePapel?: boolean } | null
  >(null);
  const [confirmacao, setConfirmacao] = useState<{ etapaId: string; papel: Papel; texto: string } | null>(null);
  const [arquivamento, setArquivamento] = useState<Arquivamento | null>(null);
  const [nova, setNova] = useState("");
  /** A etapa cujo nome acabou de ser gravado: mostra "Salvo" ao lado do campo por instantes. */
  const [salvo, setSalvo] = useState<string | null>(null);

  if (consulta.isError) {
    return (
      <p className="text-sm text-text-muted" data-testid="etapas-erro-leitura">
        {t("Não foi possível carregar as etapas deste funil agora. Recarregue a página.")}
      </p>
    );
  }
  if (!consulta.data) {
    return (
      <p className="text-sm text-text-muted" data-testid="etapas-carregando">
        {t("Carregando as etapas deste funil…")}
      </p>
    );
  }

  const etapas = consulta.data.etapas;
  const passos = passoPorEtapa(consulta.data.mapeamento);
  const ocupado = criar.isPending || editar.isPending || arquivar.isPending || consulta.isFetching;

  function aplicar(etapaId: string, patch: PatchDeEtapa) {
    if (Object.keys(patch).length === 0) return;
    setErro(null);
    setConfirmacao(null);
    // ⚠️ SÓ RECUSA DE PAPEL GANHA O LINK PARA O MAPEAMENTO. O vínculo com o
    // assistente é o que trava trocar ganho/perda; ele não tem nada a ver com
    // nome duplicado nem com ordem. Condicionar o link a "esta linha tem passo"
    // produzia o non sequitur "Já existe uma etapa chamada «Cancelado». Ir para
    // o mapeamento do assistente."
    const sobrePapel = patch.is_won !== undefined || patch.is_lost !== undefined;
    const renomeando = patch.name !== undefined;
    editar.mutate(
      { stageId: etapaId, patch },
      {
        onSuccess: () => {
          // Renomear ganha o "Salvo" discreto ao lado do campo, onde o olho
          // já está; o toast no canto é para o que mexe na lista inteira.
          if (renomeando) {
            setSalvo(etapaId);
            setTimeout(() => setSalvo((s) => (s === etapaId ? null : s)), DURACAO_DO_SALVO_MS);
          } else {
            toast.success(t("Etapa atualizada."));
          }
        },
        onError: (e) => setErro({ etapaId, texto: mensagemDeErro(e, t), sobrePapel }),
      },
    );
  }

  function escolherPapel(etapa: EtapaDoFunil, papel: Papel) {
    const patch = patchDePapel(etapa, papel);
    if (Object.keys(patch).length === 0) return;

    // ⚠️ O AVISO CITA A ETAPA QUE PERDE A MARCAÇÃO, e é a única informação que
    // importa aqui: "só uma pode" é regra abstrata; «Pago» é a coluna que vai
    // deixar de fechar negócio quando ele confirmar.
    const atual = etapas.find((e) => e.id !== etapa.id && (papel === "won" ? e.is_won : e.is_lost));
    if ((papel === "won" || papel === "lost") && atual) {
      setErro(null);
      setConfirmacao({
        etapaId: etapa.id,
        papel,
        texto:
          papel === "won"
            ? `${t("Só uma etapa pode ser a de venda fechada. Marcar esta desmarca")} «${atual.name}».`
            : `${t("Só uma etapa pode ser a de perdido. Marcar esta desmarca")} «${atual.name}».`,
      });
      return;
    }
    aplicar(etapa.id, patch);
  }

  function pedirArquivamento(etapa: EtapaDoFunil, destino: string | null) {
    setErro(null);
    arquivar.mutate(
      { stageId: etapa.id, destinoId: destino },
      {
        onSuccess: () => {
          setArquivamento(null);
          toast.success(`«${etapa.name}» ${t("saiu do quadro.")}`);
        },
        onError: (e) => {
          // Negócios parados na etapa não é recusa final: é a pergunta "para
          // onde eles vão?", e QUEM DIZ que é esse o caso é o servidor
          // (`precisa_destino`), não uma re-derivação daqui.
          const caso = casoDoErro(e);
          setArquivamento({
            etapaId: etapa.id,
            negocios: caso.negocios,
            destino: null,
            erro: caso.precisaDestino ? null : mensagemDeErro(e, t),
          });
        },
      },
    );
  }

  function criarEtapa() {
    const nome = nova.trim();
    if (!nome) return;
    setErro(null);
    criar.mutate(nome, {
      onSuccess: () => {
        setNova("");
        toast.success(`«${nome}» ${t("entrou no fim do funil.")}`);
      },
      onError: (e) => setErro({ etapaId: null, texto: mensagemDeErro(e, t) }),
    });
  }

  return (
    <div
      className="@container space-y-4"
      id={ancoraDasEtapas(pipelineId)}
      data-testid={`etapas-${pipelineId}`}
    >
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">{t("Etapas deste funil")}</h3>
        <p className="text-sm leading-relaxed text-text-muted">
          {t(
            "Renomeie direto no campo, mude a ordem com as setas e use o menu de cada etapa para marcar venda fechada, perdido ou arquivar.",
          )}
        </p>
      </div>

      <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
        {etapas.map((etapa, i) => {
          const passo = passos.get(etapa.id) ?? null;
          const papel = papelDaEtapa(etapa);
          const primeira = i === 0;
          const ultima = i === etapas.length - 1;
          const erroDaLinha = erro?.etapaId === etapa.id ? erro.texto : null;
          const confirmandoAqui = confirmacao?.etapaId === etapa.id ? confirmacao : null;
          const arquivandoAqui = arquivamento?.etapaId === etapa.id ? arquivamento : null;
          const destinos = destinosPossiveis(etapas, etapa.id);

          return (
            <li
              key={`${etapa.id}:${etapa.name}`}
              className="flex flex-col gap-2 p-3"
              data-testid={`etapa-${etapa.id}`}
            >
              {/* Uma linha: número, nome (que ocupa TODO o espaço que sobra),
                  selo do papel, setas e menu. Nada tem largura fixa além do
                  que é ícone; no contêiner estreito o selo desce para baixo do
                  nome (`@md:`), e o nome nunca encolhe abaixo do legível. */}
              <div className="flex items-start gap-2">
                <span className="mt-2 w-5 shrink-0 text-right text-xs tabular-nums text-text-muted">
                  {i + 1}.
                </span>

                <div className="flex min-w-0 flex-1 flex-col gap-1.5 @md:flex-row @md:items-center @md:gap-2">
                  <NomeDaEtapa
                    etapa={etapa}
                    desabilitado={ocupado}
                    salvo={salvo === etapa.id}
                    aoConfirmar={(nome) => aplicar(etapa.id, { name: nome })}
                  />
                  {papel !== "nenhum" && (
                    <Badge
                      variant={papel === "won" ? "success" : "neutral"}
                      className="w-fit shrink-0"
                      data-testid={`papel-${etapa.id}`}
                    >
                      {t(ROTULO_DO_PAPEL[papel])}
                    </Badge>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-0.5">
                  {/* `title` no invólucro, não no botão: botão desabilitado
                      não dispara evento nenhum, e a dica precisa aparecer
                      justamente quando ele está desabilitado. */}
                  <span title={primeira ? t("Já é a primeira etapa") : undefined}>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      aria-label={`${t("Mover")} «${etapa.name}» ${t("uma coluna para trás")}`}
                      data-testid={`subir-${etapa.id}`}
                      disabled={primeira || ocupado}
                      onClick={() =>
                        aplicar(etapa.id, { depois_de: vizinhoAoMover(etapas, i, "subir") })
                      }
                    >
                      <CaretUp size={16} aria-hidden />
                    </Button>
                  </span>
                  <span title={ultima ? t("Já é a última etapa") : undefined}>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      aria-label={`${t("Mover")} «${etapa.name}» ${t("uma coluna para frente")}`}
                      data-testid={`descer-${etapa.id}`}
                      disabled={ultima || ocupado}
                      onClick={() =>
                        aplicar(etapa.id, { depois_de: vizinhoAoMover(etapas, i, "descer") })
                      }
                    >
                      <CaretDown size={16} aria-hidden />
                    </Button>
                  </span>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        aria-label={`${t("Opções de")} «${etapa.name}»`}
                        data-testid={`menu-${etapa.id}`}
                        disabled={ocupado}
                      >
                        <DotsThree size={16} weight="bold" aria-hidden />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        data-testid={`marcar-won-${etapa.id}`}
                        disabled={papel === "won"}
                        onSelect={() => escolherPapel(etapa, "won")}
                      >
                        {t("Marcar como venda fechada")}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        data-testid={`marcar-lost-${etapa.id}`}
                        disabled={papel === "lost"}
                        onSelect={() => escolherPapel(etapa, "lost")}
                      >
                        {t("Marcar como perdido")}
                      </DropdownMenuItem>
                      {/* A API recusa tirar a marcação (o funil precisa de
                          uma de cada) e explica como fazer. A opção fica
                          para que a explicação chegue a quem procura por ela,
                          em vez de a pessoa concluir que não existe jeito. */}
                      {papel !== "nenhum" && (
                        <DropdownMenuItem
                          data-testid={`desmarcar-${etapa.id}`}
                          onSelect={() => escolherPapel(etapa, "nenhum")}
                        >
                          {t("Tirar a marcação")}
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        data-testid={`arquivar-${etapa.id}`}
                        onSelect={() => {
                          setErro(null);
                          setArquivamento({ etapaId: etapa.id, negocios: null, destino: null, erro: null });
                        }}
                      >
                        <Archive size={14} className="mr-2" aria-hidden />
                        {t("Arquivar etapa")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>

              {/* Uma coluna que apareceu no quadro sem o dono ter criado precisa
                  dizer de onde veio, senão o assistente muda o funil e a única
                  pista fica no log que nenhuma tela lê. */}
              <SeloDeAutoria
                kind={etapa.last_change_actor_kind ?? null}
                em={etapa.last_change_at ?? null}
                className={`etapa-autoria-${etapa.id}`}
              />

              {passo && (
                <p className="text-xs text-text-muted" data-testid={`passo-de-${etapa.id}`}>
                  {t("O assistente usa esta etapa para")} «{t(ROTULO_DO_PASSO[passo])}».{" "}
                  <a className="underline underline-offset-2" href={`#${ancoraMapeamento}`}>
                    {t("Mudar isso")}
                  </a>
                </p>
              )}

              {confirmandoAqui && (
                <Card
                  className="flex flex-col gap-3 border-warning bg-warning-bg p-4"
                  data-testid={`confirmar-papel-${etapa.id}`}
                >
                  <p className="text-sm leading-relaxed">{confirmandoAqui.texto}</p>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      data-testid={`confirmar-papel-sim-${etapa.id}`}
                      onClick={() => aplicar(etapa.id, patchDePapel(etapa, confirmandoAqui.papel))}
                    >
                      {t("Marcar mesmo assim")}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmacao(null)}>
                      {t("Cancelar")}
                    </Button>
                  </div>
                </Card>
              )}

              {arquivandoAqui && (
                <Card
                  className="flex flex-col gap-3 border-border p-4"
                  data-testid={`arquivar-painel-${etapa.id}`}
                >
                  {arquivandoAqui.erro ? (
                    <p className="text-sm leading-relaxed" data-testid={`arquivar-erro-${etapa.id}`}>
                      {arquivandoAqui.erro}
                    </p>
                  ) : arquivandoAqui.negocios === null ? (
                    <p className="text-sm leading-relaxed">
                      {t("Arquivar")} «{etapa.name}»?{" "}
                      {t(
                        "A coluna sai do quadro e para de receber negócios novos. Nada é apagado (o histórico de quem passou por ela continua guardado), mas",
                      )}{" "}
                      <strong>{t("não dá para trazer a coluna de volta por aqui")}</strong>.
                    </p>
                  ) : destinos.length === 0 ? (
                    // Sem destino possível não há pergunta a fazer, e mandar
                    // escolher entre nada seria um beco sem saída.
                    <p className="text-sm leading-relaxed" data-testid={`arquivar-sem-destino-${etapa.id}`}>
                      {contagemDeNegocios(arquivandoAqui.negocios, t)}{" "}
                      {arquivandoAqui.negocios === 1
                        ? t("está nesta etapa e não há outra coluna em aberto para recebê-lo.")
                        : t(
                            "estão nesta etapa e não há outra coluna em aberto para recebê-los.",
                          )}{" "}
                      {t("Crie uma etapa antes de arquivar")} «{etapa.name}».
                    </p>
                  ) : (
                    <>
                      <p className="text-sm leading-relaxed" data-testid={`arquivar-pergunta-${etapa.id}`}>
                        {contagemDeNegocios(arquivandoAqui.negocios, t)}{" "}
                        {arquivandoAqui.negocios === 1
                          ? t("está nesta etapa. Para onde ele vai?")
                          : t("estão nesta etapa. Para onde eles vão?")}
                      </p>
                      <div className="@sm:w-72">
                        <Select
                          value={arquivandoAqui.destino ?? ""}
                          onValueChange={(v) =>
                            setArquivamento({ ...arquivandoAqui, destino: v })
                          }
                        >
                          <SelectTrigger
                            aria-label={`${t("Para onde vão os negócios de")} «${etapa.name}»`}
                            data-testid={`destino-${etapa.id}`}
                          >
                            <SelectValue placeholder={t("Escolha a etapa")} />
                          </SelectTrigger>
                          <SelectContent>
                            {destinos.map((d) => (
                              <SelectItem key={d.id} value={d.id}>
                                {d.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </>
                  )}

                  {/* ⚠️ A SEGUNDA IRREVERSIBILIDADE, e ela era silenciosa.
                      `validarArquivamento` recusa arquivar a etapa de ganho/perda,
                      mas NÃO olha `agent_stage_hint`, e o DELETE não limpa o hint:
                      `resolveDestinoDoAgente` procura o alvo com `!is_archived`,
                      então arquivar simplesmente desliga esse passo do assistente.
                      O mapeamento volta sozinho para «não mover o card», ninguém é
                      avisado, e como a coluna não volta o vínculo só se refaz
                      escolhendo OUTRA etapa. Avisar da coluna e calar sobre isto era
                      contar metade. */}
                  {passo && !arquivandoAqui.erro && (
                    <p
                      className="text-sm leading-relaxed text-warning-fg"
                      data-testid={`arquivar-perde-passo-${etapa.id}`}
                    >
                      {t("Esta etapa é a que o assistente usa para")} «{t(ROTULO_DO_PASSO[passo])}».{" "}
                      {t(
                        "Arquivando, ele para de mover o card nesse passo até você escolher outra etapa em",
                      )}{" "}
                      <a className="underline underline-offset-2" href={`#${ancoraMapeamento}`}>
                        «{t("Para onde o card vai em cada passo")}»
                      </a>
                      .
                    </p>
                  )}

                  <div className="flex gap-2">
                    {!arquivandoAqui.erro && !(arquivandoAqui.negocios !== null && destinos.length === 0) && (
                      <Button
                        size="sm"
                        data-testid={`arquivar-confirmar-${etapa.id}`}
                        // Com negócios na etapa, arquivar sem destino não é
                        // oferecido: perder o rastro deles não pode ser um
                        // clique de distância.
                        disabled={
                          ocupado ||
                          (arquivandoAqui.negocios !== null && !arquivandoAqui.destino)
                        }
                        onClick={() => pedirArquivamento(etapa, arquivandoAqui.destino)}
                      >
                        {arquivandoAqui.negocios === null
                          ? t("Arquivar")
                          : t("Mover os negócios e arquivar")}
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => setArquivamento(null)}>
                      {arquivandoAqui.erro ? t("Fechar") : t("Cancelar")}
                    </Button>
                  </div>
                </Card>
              )}

              {erroDaLinha && (
                <Card
                  className="flex items-start gap-3 border-warning bg-warning-bg p-4"
                  data-testid={`etapa-erro-${etapa.id}`}
                >
                  <Warning size={18} className="mt-0.5 shrink-0 text-warning-fg" aria-hidden />
                  <p className="text-sm leading-relaxed">
                    {erroDaLinha}
                    {passo && erro?.sobrePapel && (
                      <>
                        {" "}
                        <a className="underline underline-offset-2" href={`#${ancoraMapeamento}`}>
                          {t("Ir para o mapeamento do assistente")}
                        </a>
                        .
                      </>
                    )}
                  </p>
                </Card>
              )}
            </li>
          );
        })}
      </ul>

      {/* Sempre visível no fim da lista: quem quer uma etapa nova não precisa
          descobrir um botão que abre um campo. */}
      <form
        className="flex flex-col gap-2 @sm:flex-row @sm:items-center"
        onSubmit={(e) => {
          e.preventDefault();
          criarEtapa();
        }}
      >
        <Input
          value={nova}
          maxLength={80}
          placeholder={t("Nome da nova etapa")}
          aria-label={t("Nome da nova etapa")}
          data-testid="nova-etapa-nome"
          disabled={ocupado}
          onChange={(e) => setNova(e.target.value)}
          className="min-w-0 flex-1 @sm:max-w-xs"
        />
        <Button
          type="submit"
          size="sm"
          variant="secondary"
          className="shrink-0"
          data-testid="nova-etapa-criar"
          disabled={ocupado || nova.trim().length === 0}
        >
          <Plus size={16} className="mr-1" aria-hidden />
          {t("Adicionar etapa")}
        </Button>
      </form>

      {erro?.etapaId === null && (
        <Card
          className="flex items-start gap-3 border-warning bg-warning-bg p-4"
          data-testid="etapas-erro"
        >
          <Warning size={18} className="mt-0.5 shrink-0 text-warning-fg" aria-hidden />
          <p className="text-sm leading-relaxed">{erro.texto}</p>
        </Card>
      )}
    </div>
  );
}

/**
 * O nome da etapa, editado no lugar.
 *
 * ⚠️ SALVA AO CONFIRMAR (Enter ou sair do campo), NUNCA A CADA TECLA: um PATCH
 * por caractere gravaria "P", "Pr", "Pro"… no banco e faria a validação de nome
 * duplicado disparar no meio da digitação. O rascunho é local; a fonte da verdade
 * continua sendo o servidor. A linha inteira é remontada quando o nome gravado
 * muda (`key` da `li`), então uma edição feita em outra aba não fica escondida
 * atrás de um rascunho velho.
 */
function NomeDaEtapa({
  etapa,
  desabilitado,
  salvo,
  aoConfirmar,
}: {
  etapa: EtapaDoFunil;
  desabilitado: boolean;
  /** Acabou de gravar: mostra "Salvo" dentro do campo por instantes. */
  salvo: boolean;
  aoConfirmar: (nome: string) => void;
}) {
  const t = useT();
  const [rascunho, setRascunho] = useState(etapa.name);

  function confirmar() {
    const nome = rascunho.trim();
    if (!nome || nome === etapa.name) {
      setRascunho(etapa.name);
      return;
    }
    aoConfirmar(nome);
  }

  return (
    <div className="relative min-w-0 flex-1">
      <Input
        value={rascunho}
        maxLength={80}
        disabled={desabilitado}
        aria-label={`${t("Nome da etapa")} «${etapa.name}»`}
        data-testid={`nome-${etapa.id}`}
        onChange={(e) => setRascunho(e.target.value)}
        onBlur={confirmar}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setRascunho(etapa.name);
            e.currentTarget.blur();
          }
        }}
        className={salvo ? "pr-16" : undefined}
      />
      {salvo && (
        <span
          className="pointer-events-none absolute inset-y-0 right-3 flex items-center gap-1 text-xs text-success-fg"
          data-testid={`salvo-${etapa.id}`}
        >
          <Check size={12} aria-hidden />
          {t("Salvo")}
        </span>
      )}
    </div>
  );
}
