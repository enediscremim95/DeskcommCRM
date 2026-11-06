export interface ItemComEmbalagem {
  codigo: string;
  quantidade: number;
  preco_cents: number;
  peso_kg: number;
  altura_cm: number;
  largura_cm: number;
  comprimento_cm: number;
  embalagem_estimada: boolean;
}

export interface EmbalagemMontada {
  weight: number;
  height: number;
  width: number;
  length: number;
  subtotal_cents: number;
  embalagem_estimada: boolean;
  precisa_pessoa: boolean;
}

function arredondar(valor: number, casas: number): number {
  const fator = 10 ** casas;
  return Math.round((valor + Number.EPSILON) * fator) / fator;
}

export function montarEmbalagemUnica(itens: readonly ItemComEmbalagem[]): EmbalagemMontada {
  const weight = arredondar(
    itens.reduce((total, item) => total + item.peso_kg * item.quantidade, 0),
    3,
  );
  const height = arredondar(
    itens.reduce((total, item) => total + item.altura_cm * item.quantidade, 0),
    1,
  );
  const width = arredondar(Math.max(...itens.map((item) => item.largura_cm)), 1);
  const length = arredondar(Math.max(...itens.map((item) => item.comprimento_cm)), 1);
  const subtotal_cents = itens.reduce(
    (total, item) => total + item.preco_cents * item.quantidade,
    0,
  );

  return {
    weight,
    height,
    width,
    length,
    subtotal_cents,
    embalagem_estimada: itens.some((item) => item.embalagem_estimada),
    precisa_pessoa: weight > 30 || height + width + length > 200,
  };
}
