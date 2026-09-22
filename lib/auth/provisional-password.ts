import { randomInt } from "node:crypto";

const UPPERCASE = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWERCASE = "abcdefghijkmnpqrstuvwxyz";
const DIGITS = "23456789";
const ALPHABET = UPPERCASE + LOWERCASE + DIGITS;

/** Doze caracteres copiáveis, com as três classes e sem O, 0, l ou 1. */
export function generateProvisionalPassword(): string {
  const chars = [pick(UPPERCASE), pick(LOWERCASE), pick(DIGITS)];
  while (chars.length < 12) chars.push(pick(ALPHABET));
  for (let index = chars.length - 1; index > 0; index -= 1) {
    const other = randomInt(index + 1);
    [chars[index], chars[other]] = [chars[other]!, chars[index]!];
  }
  return chars.join("");
}

function pick(source: string): string {
  return source[randomInt(source.length)]!;
}
