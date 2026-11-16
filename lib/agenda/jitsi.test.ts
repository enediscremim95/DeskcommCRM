import { describe, expect, it } from "vitest";
import { gerarJitsiVideoUrl, jitsiVideoUrl } from "./jitsi";

describe("Jitsi da agenda", () => {
  it("gera uma sala legível com entropia suficiente e alfabeto seguro", () => {
    const primeira = gerarJitsiVideoUrl("Consulta São João");
    const segunda = gerarJitsiVideoUrl("Consulta São João");

    expect(primeira).toMatch(
      /^https:\/\/meet\.jit\.si\/consulta-sao-joao-[a-f0-9]{20}$/,
    );
    expect(segunda).not.toBe(primeira);
    expect(jitsiVideoUrl(primeira)).toBe(primeira);
  });

  it.each([
    "http://meet.jit.si/sala-segura",
    "https://evil.example/sala-segura",
    "https://usuario@meet.jit.si/sala-segura",
    "https://meet.jit.si:444/sala-segura",
    "https://meet.jit.si/sala/extra",
    "https://meet.jit.si/sala-segura?token=1",
    "https://meet.jit.si/sala-segura#trecho",
  ])("rejeita URL fora do contrato: %s", (url) => {
    expect(jitsiVideoUrl(url)).toBeNull();
  });
});
