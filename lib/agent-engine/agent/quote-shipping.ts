import { z } from "zod";

import { montarEmbalagemUnica, type EmbalagemMontada, type ItemComEmbalagem } from "@/lib/frete/montar-embalagem";
import {
  cotarNoMelhorEnvio,
  ErroMelhorEnvio,
  type CotacaoMelhorEnvioInput,
  type OpcaoMelhorEnvio,
} from "@/lib/frete/melhor-envio";
import { decifrarTokenDeFrete } from "@/lib/frete/segredo";
import type { Queryable } from "../queue/queue";

export const quoteShippingInputSchema = z
  .object({
    cep: z
      .string()
      .trim()
      .regex(/^\d{5}-?\d{3}$/u, "informe um CEP com 8 dígitos"),
    itens: z
      .array(
        z
          .object({
            codigo: z.string().trim().min(1).max(120),
            quantidade: z.number().int().min(1).max(100),
          })
          .strict(),
      )
      .min(1)
      .max(6),
  })
  .strict();

interface ConfiguracaoFrete {
  base_url: string;
  user_agent: string;
  origin_postal_code: string;
  token_ciphertext: unknown;
  service_allowlist: number[];
  declared_value_mode: "subtotal" | "zero";
  packaging_margin_cents: number;
  local_postal_ranges: string[];
}

interface ProdutoFrete {
  codigo: string;
  preco_cents: number | string;
  peso_kg: number | string | null;
  altura_cm: number | string | null;
  largura_cm: number | string | null;
  comprimento_cm: number | string | null;
  embalagem_estimada: boolean;
}

export interface EstadoCotacaoFrete {
  cotacoes: number;
}

const COMO_FALAR =
  "diga que é o valor de referência do frete e que o prazo de transporte soma ao prazo de produção; a Lorenza confirma o frete no fechamento do pedido; nunca prometa data de chegada nem de envio";
const COMO_FALAR_SIMULACAO =
  "esta é uma cotação sintética do sandbox, sem consulta à transportadora; use apenas para exercitar a conversa e nunca apresente estes valores como cotação real";

function numeroPositivo(valor: number | string | null): number | null {
  if (valor === null) return null;
  const n = typeof valor === "number" ? valor : Number(valor);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function precoEmCentavos(valor: number | string): number | null {
  const n = typeof valor === "number" ? valor : Number(valor);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

function formatarReais(centavos: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })
    .format(centavos / 100)
    .replaceAll("\u00a0", " ");
}

function cepEhLocal(cep: string, faixas: readonly string[]): boolean {
  const prefixo = Number(cep.slice(0, 5));
  return faixas.some((faixa) => {
    const match = /^(\d{5})-(\d{5})$/u.exec(faixa);
    return match ? prefixo >= Number(match[1]) && prefixo <= Number(match[2]) : false;
  });
}

function selecionarOpcoes(opcoes: readonly OpcaoMelhorEnvio[]): OpcaoMelhorEnvio[] {
  if (opcoes.length === 0) return [];
  const porPreco = [...opcoes].sort(
    (a, b) =>
      a.valor_cents - b.valor_cents ||
      a.prazo_transporte_dias_uteis - b.prazo_transporte_dias_uteis,
  );
  const porPrazo = [...opcoes].sort(
    (a, b) =>
      a.prazo_transporte_dias_uteis - b.prazo_transporte_dias_uteis ||
      a.valor_cents - b.valor_cents,
  );
  const barata = porPreco[0]!;
  const rapida = porPrazo[0]!;
  if (barata.id === rapida.id) return [barata];

  const escolhidas = [barata, rapida];
  const restantes = porPreco.filter(
    (opcao) => !escolhidas.some((item) => item.id === opcao.id),
  );
  if (restantes.length > 0) {
    escolhidas.push(restantes[Math.floor((restantes.length - 1) / 2)]!);
  }
  return escolhidas;
}

function erro(code: string, message: string): Record<string, unknown> {
  return { ok: false, error: { code, message } };
}

function erroDeLimite(): Record<string, unknown> {
  return erro(
    "frete_limite_do_turno",
    "limite de 2 cotações neste turno; passe para uma pessoa se ainda precisar confirmar.",
  );
}

async function carregarEmbalagem(args: {
  db: Queryable;
  organizationId: string;
  input: z.infer<typeof quoteShippingInputSchema>;
}): Promise<{ embalagem: EmbalagemMontada } | { resposta: Record<string, unknown> }> {
  const codigos = [...new Set(args.input.itens.map((item) => item.codigo))];
  const produtos = await args.db.query<ProdutoFrete>(
    `select codigo,preco_cents,peso_kg,altura_cm,largura_cm,comprimento_cm,embalagem_estimada
       from catalog_products
      where organization_id=$1 and codigo=any($2::text[]) and ativo=true`,
    [args.organizationId, codigos],
  );
  const porCodigo = new Map(produtos.rows.map((produto) => [produto.codigo, produto]));
  const itens: ItemComEmbalagem[] = [];
  for (const pedido of args.input.itens) {
    const produto = porCodigo.get(pedido.codigo);
    if (!produto) {
      return {
        resposta: erro(
          "produto_nao_encontrado",
          `o item ${pedido.codigo} não está ativo no catálogo desta loja; passe para uma pessoa.`,
        ),
      };
    }
    const peso = numeroPositivo(produto.peso_kg);
    const altura = numeroPositivo(produto.altura_cm);
    const largura = numeroPositivo(produto.largura_cm);
    const comprimento = numeroPositivo(produto.comprimento_cm);
    const preco = precoEmCentavos(produto.preco_cents);
    if (
      peso === null ||
      altura === null ||
      largura === null ||
      comprimento === null ||
      preco === null
    ) {
      return {
        resposta: erro(
          "sem_peso_cadastrado",
          `o item ${pedido.codigo} está sem peso, medidas ou preço válidos; passe para uma pessoa.`,
        ),
      };
    }
    itens.push({
      codigo: produto.codigo,
      quantidade: pedido.quantidade,
      preco_cents: preco,
      peso_kg: peso,
      altura_cm: altura,
      largura_cm: largura,
      comprimento_cm: comprimento,
      embalagem_estimada: produto.embalagem_estimada,
    });
  }

  return { embalagem: montarEmbalagemUnica(itens) };
}

function respostaPacoteForaDoLimite(
  embalagem: EmbalagemMontada,
  retirada: boolean,
  simulada: boolean,
): Record<string, unknown> {
  return {
    ok: true,
    simulada,
    precisa_pessoa: true,
    retirada_ou_uber_disponivel: retirada,
    valor_de_referencia: true,
    embalagem_estimada: embalagem.embalagem_estimada,
    como_falar: simulada ? COMO_FALAR_SIMULACAO : COMO_FALAR,
    mensagem: "o pacote ultrapassa o limite de 30 kg ou 200 cm somados; passe para uma pessoa.",
  };
}

export async function executarCotacaoDeFrete(args: {
  db: Queryable;
  organizationId: string;
  input: z.infer<typeof quoteShippingInputSchema>;
  estado: EstadoCotacaoFrete;
  cotar?: (input: CotacaoMelhorEnvioInput) => Promise<OpcaoMelhorEnvio[]>;
  decifrarToken?: (valor: unknown) => string;
}): Promise<Record<string, unknown>> {
  const input = quoteShippingInputSchema.parse(args.input);
  const cep = input.cep.replace("-", "");
  if (args.estado.cotacoes >= 2) return erroDeLimite();

  const configuracao = await args.db.query<ConfiguracaoFrete>(
    `select base_url,user_agent,origin_postal_code,token_ciphertext,service_allowlist,
            declared_value_mode,packaging_margin_cents,local_postal_ranges
       from organization_shipping_settings
      where organization_id=$1 and provider='melhor_envio' and ativo=true
      limit 1`,
    [args.organizationId],
  );
  const cfg = configuracao.rows[0];
  if (!cfg) {
    return erro(
      "frete_nao_configurado",
      "a cotação automática de frete não está configurada nesta loja; passe para uma pessoa.",
    );
  }

  const carregada = await carregarEmbalagem({
    db: args.db,
    organizationId: args.organizationId,
    input,
  });
  if ("resposta" in carregada) return carregada.resposta;
  const { embalagem } = carregada;
  const retirada = cepEhLocal(cep, cfg.local_postal_ranges);
  if (embalagem.precisa_pessoa) {
    return respostaPacoteForaDoLimite(embalagem, retirada, false);
  }

  let token: string;
  try {
    token = (args.decifrarToken ?? decifrarTokenDeFrete)(cfg.token_ciphertext);
  } catch {
    return erro(
      "frete_token_indisponivel",
      "a credencial de cotação do frete está indisponível; passe para uma pessoa.",
    );
  }

  args.estado.cotacoes += 1;
  try {
    const opcoes = await (args.cotar ?? cotarNoMelhorEnvio)({
      baseUrl: cfg.base_url,
      userAgent: cfg.user_agent,
      token,
      fromPostalCode: cfg.origin_postal_code,
      toPostalCode: cep,
      package: {
        height: embalagem.height,
        width: embalagem.width,
        length: embalagem.length,
        weight: embalagem.weight,
      },
      insuranceValue:
        cfg.declared_value_mode === "subtotal" ? embalagem.subtotal_cents / 100 : 0,
      serviceAllowlist: cfg.service_allowlist,
    });
    const selecionadas = selecionarOpcoes(opcoes);
    if (selecionadas.length === 0) {
      return erro(
        "frete_sem_servico_disponivel",
        "nenhum serviço de frete autorizado está disponível para este pacote; passe para uma pessoa.",
      );
    }
    return {
      ok: true,
      simulada: false,
      opcoes: selecionadas.map((opcao) => {
        const valor = opcao.valor_cents + cfg.packaging_margin_cents;
        return {
          servico: `${opcao.nome} (${opcao.empresa})`,
          valor: formatarReais(valor),
          valor_cents: valor,
          prazo_transporte_dias_uteis: opcao.prazo_transporte_dias_uteis,
        };
      }),
      retirada_ou_uber_disponivel: retirada,
      valor_de_referencia: true,
      embalagem_estimada: embalagem.embalagem_estimada,
      como_falar: COMO_FALAR,
    };
  } catch (falha) {
    if (falha instanceof ErroMelhorEnvio) return erro(falha.code, falha.message);
    return erro(
      "frete_indisponivel",
      "não consegui cotar o frete agora; passe para uma pessoa.",
    );
  }
}

/**
 * Cotação determinística exclusiva do sandbox. Não lê configuração de frete,
 * não decifra token e não possui dependência de rede.
 */
export async function simularCotacaoDeFrete(args: {
  db: Queryable;
  organizationId: string;
  input: z.infer<typeof quoteShippingInputSchema>;
  estado: EstadoCotacaoFrete;
}): Promise<Record<string, unknown>> {
  const input = quoteShippingInputSchema.parse(args.input);
  const cep = input.cep.replace("-", "");
  if (args.estado.cotacoes >= 2) return erroDeLimite();

  const carregada = await carregarEmbalagem({
    db: args.db,
    organizationId: args.organizationId,
    input,
  });
  if ("resposta" in carregada) return carregada.resposta;
  const { embalagem } = carregada;
  if (embalagem.precisa_pessoa) {
    return respostaPacoteForaDoLimite(embalagem, false, true);
  }

  args.estado.cotacoes += 1;
  const pesoCubado = (embalagem.height * embalagem.width * embalagem.length) / 6_000;
  const distanciaSintetica = Number(cep.slice(0, 2)) * 5;
  const base = Math.max(
    1_590,
    Math.round(990 + Math.max(embalagem.weight, pesoCubado) * 350 + distanciaSintetica),
  );
  const variacaoPrazo = Number(cep.at(-1)) % 3;
  const opcoes = [
    {
      servico: "Econômico (simulação)",
      valor: formatarReais(base),
      valor_cents: base,
      prazo_transporte_dias_uteis: 5 + variacaoPrazo,
    },
    {
      servico: "Expresso (simulação)",
      valor: formatarReais(base + 1_200),
      valor_cents: base + 1_200,
      prazo_transporte_dias_uteis: 2 + (variacaoPrazo % 2),
    },
  ];

  return {
    ok: true,
    simulada: true,
    opcoes,
    retirada_ou_uber_disponivel: false,
    valor_de_referencia: true,
    embalagem_estimada: embalagem.embalagem_estimada,
    como_falar: COMO_FALAR_SIMULACAO,
  };
}
