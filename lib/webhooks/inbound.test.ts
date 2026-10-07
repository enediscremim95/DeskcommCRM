import { describe, it, expect } from "vitest";
import { mapInboundPayload, normalizePhoneBR, verifyInboundSignature } from "@/lib/webhooks/inbound";
import { createHmac } from "node:crypto";

describe("normalizePhoneBR", () => {
  it("já em E.164 com o nono passa direto", () => expect(normalizePhoneBR("+5511998765432")).toBe("+5511998765432"));
  it("DDD+numero BR ganha +55", () => expect(normalizePhoneBR("11 99876-5432")).toBe("+5511998765432"));
  it("com 55 na frente sem +", () => expect(normalizePhoneBR("5511998765432")).toBe("+5511998765432"));
  it("celular antigo sem o nono ganha o 9", () => {
    expect(normalizePhoneBR("+553284793302")).toBe("+5532984793302");
    expect(normalizePhoneBR("3284793302")).toBe("+5532984793302");
  });
  it("fixo BR 10 dígitos", () => expect(normalizePhoneBR("1133334444")).toBe("+551133334444"));
  it.each([
    ["092981851977", "+5592981851977"],
    ["041995999437", "+5541995999437"],
    ["041988034020", "+5541988034020"],
    ["016981493138", "+5516981493138"],
    ["011930337966", "+5511930337966"],
  ])("remove somente o 0 de tronco de %s", (raw, esperado) => {
    expect(normalizePhoneBR(raw)).toBe(esperado);
  });
  it.each([
    ["+557742042866 774 204 2866", "+557742042866"],
    ["±34632230195 632230195", "+34632230195"],
    ["+1 475 3091544 1 475 309 1544", "+14753091544"],
  ])("remove uma cópia completa e válida de %s", (raw, esperado) => {
    expect(normalizePhoneBR(raw)).toBe(esperado);
  });
  it.each([
    "219998282287",
    "319958814990",
    "189818000102",
    "999237616",
    "981996678",
    "992052070",
    "115",
  ])("não adivinha como consertar %s", (raw) => {
    expect(normalizePhoneBR(raw)).toBeNull();
  });
  it("não interpreta 0 + operadora como prefixo de tronco simples", () => {
    expect(normalizePhoneBR("01511999998888")).toBeNull();
  });
  it("lixo → null", () => expect(normalizePhoneBR("abc")).toBeNull());
  it("vazio/não-string → null", () => {
    expect(normalizePhoneBR("")).toBeNull();
    expect(normalizePhoneBR(42 as unknown)).toBeNull();
  });
});

describe("mapInboundPayload", () => {
  it("aliases default: nome/telefone/email", () => {
    const m = mapInboundPayload({ nome: "Ana", telefone: "11998765432", email: "a@b.com" });
    expect(m).toMatchObject({ name: "Ana", phone: "+5511998765432", email: "a@b.com" });
  });
  it("whatsapp como alias de phone; extras viram custom_fields; UTMs e página viram source_metadata", () => {
    const m = mapInboundPayload({
      name: "Bo",
      whatsapp: "+5511998765432",
      empresa: "ACME",
      utm_source: "instagram",
      pagina: "Dia dos Professores",
    });
    expect(m.phone).toBe("+5511998765432");
    expect(m.custom_fields).toEqual({ empresa: "ACME" });
    expect(m.source_metadata).toEqual({
      utm_source: "instagram",
      pagina: "Dia dos Professores",
    });
  });
  it("field_map custom tem precedência sobre defaults", () => {
    const m = mapInboundPayload({ contato: "Zé" }, { name: ["contato"] });
    expect(m.name).toBe("Zé");
  });
  it("payload sem nada mapeável → tudo null e extras preservados", () => {
    const m = mapInboundPayload({ foo: "bar" });
    expect(m.name).toBeNull();
    expect(m.phone).toBeNull();
    expect(m.custom_fields).toEqual({ foo: "bar" });
  });
  it("valores não-string são stringificados em custom_fields; objetos aninhados descartados", () => {
    const m = mapInboundPayload({ nome: "Ana", idade: 30, nested: { a: 1 } });
    expect(m.custom_fields).toEqual({ idade: "30" });
  });
});

describe("verifyInboundSignature", () => {
  const body = '{"nome":"Ana"}';
  const secret = "s3cr3t";
  const sig = createHmac("sha256", secret).update(body).digest("hex");
  it("assinatura válida", () => expect(verifyInboundSignature(body, sig, secret)).toBe(true));
  it("assinatura errada", () => expect(verifyInboundSignature(body, "deadbeef", secret)).toBe(false));
  it("header ausente", () => expect(verifyInboundSignature(body, null, secret)).toBe(false));
  it("header com tamanho diferente não lança (timingSafeEqual exige mesmo length)", () =>
    expect(verifyInboundSignature(body, "abc", secret)).toBe(false));
});
