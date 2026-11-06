import { bufToBytea, byteaToBuffer, decryptKey, encryptKey } from "@/lib/crypto/aes_gcm";

const VERSAO = 1;
const TAMANHO_IV = 12;
const TAMANHO_TAG = 16;
const CABECALHO = 1 + TAMANHO_IV + TAMANHO_TAG;

/**
 * A tabela de frete tem uma única coluna `bytea`. Empacotamos os três buffers
 * do helper canônico sem criar outra cifra: versão, IV, tag e ciphertext.
 */
export function cifrarTokenDeFrete(token: string): string {
  const cifrado = encryptKey(token);
  return bufToBytea(
    Buffer.concat([Buffer.from([VERSAO]), cifrado.iv, cifrado.tag, cifrado.ciphertext]),
  );
}

export function decifrarTokenDeFrete(valor: unknown): string {
  try {
    const pacote = byteaToBuffer(valor);
    if (pacote.length <= CABECALHO || pacote[0] !== VERSAO) {
      throw new Error("pacote_invalido");
    }
    return decryptKey({
      iv: pacote.subarray(1, 1 + TAMANHO_IV),
      tag: pacote.subarray(1 + TAMANHO_IV, CABECALHO),
      ciphertext: pacote.subarray(CABECALHO),
    });
  } catch {
    throw new Error("frete_token_indisponivel");
  }
}
