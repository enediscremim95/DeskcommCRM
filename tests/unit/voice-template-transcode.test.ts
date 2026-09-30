import { writeFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  ConversaoDeVozFalhou,
  converterAudioParaVozOpus,
} from "@/lib/messaging/media/voice-transcode";

describe("áudio de resposta rápida", () => {
  it("sempre produz OGG/Opus mono em parâmetros explícitos", async () => {
    let argsExecutados: string[] = [];
    const result = await converterAudioParaVozOpus(
      { buffer: Buffer.from("entrada"), mime: "audio/mpeg" },
      {
        run: async (args) => {
          argsExecutados = args;
          await writeFile(args.at(-1)!, Buffer.from("ogg-opus"));
        },
      },
    );

    expect(result.mime).toBe("audio/ogg; codecs=opus");
    expect(result.buffer.toString()).toBe("ogg-opus");
    expect(argsExecutados).toEqual(
      expect.arrayContaining(["-ac", "1", "-ar", "48000", "-c:a", "libopus", "-f", "ogg"]),
    );
  });

  it("falha fechada para conteúdo não declarado como áudio", async () => {
    await expect(
      converterAudioParaVozOpus({ buffer: Buffer.from("x"), mime: "application/octet-stream" }),
    ).rejects.toBeInstanceOf(ConversaoDeVozFalhou);
  });

  it("falha fechada quando a conversão não materializa uma voz", async () => {
    await expect(
      converterAudioParaVozOpus(
        { buffer: Buffer.from("entrada"), mime: "audio/wav" },
        { run: async () => {} },
      ),
    ).rejects.toBeInstanceOf(ConversaoDeVozFalhou);
  });
});
