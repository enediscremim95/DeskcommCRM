/**
 * Espera `promessa` por no máximo `ms`; estourou ou falhou → `padrao`.
 * Para o que ENFEITA a tela (faixa de conexão caída, marca da instalação): não
 * pode segurar o layout inteiro — era o "esqueleto cinza" eterno quando um
 * desses lia devagar. Não use para decisão de acesso.
 */
export function comPrazoOuPadrao<T>(promessa: PromiseLike<T>, ms: number, padrao: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(padrao), ms);
    Promise.resolve(promessa).then(
      (v) => { clearTimeout(timer); resolve(v); },
      () => { clearTimeout(timer); resolve(padrao); },
    );
  });
}
