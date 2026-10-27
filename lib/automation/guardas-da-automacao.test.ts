import { describe, expect, it } from "vitest";

import { lerGuardasDaAutomacao } from "@/lib/automation/guardas-da-automacao";

describe("organizations.settings.automation_guards", () => {
  it.each([
    undefined,
    null,
    {},
    { automation_guards: {} },
    { automation_guards: null },
    { automation_guards: [] },
    { automation_guards: "ligado" },
  ])("mantém as duas travas desligadas para configuração ausente ou de tipo errado", (settings) => {
    expect(lerGuardasDaAutomacao(settings)).toEqual({ sameChannelOnly: false });
  });

  it("aceita apenas os valores exatos do contrato", () => {
    expect(
      lerGuardasDaAutomacao({
        automation_guards: {
          max_message_age_minutes: 45,
          same_channel_only: true,
        },
      }),
    ).toEqual({ maxMessageAgeMinutes: 45, sameChannelOnly: true });
  });

  it.each([0, -1, "45", Number.NaN, Number.POSITIVE_INFINITY])(
    "desliga somente a trava de idade quando o limite é inválido: %j",
    (maxMessageAgeMinutes) => {
      expect(
        lerGuardasDaAutomacao({
          automation_guards: {
            max_message_age_minutes: maxMessageAgeMinutes,
            same_channel_only: true,
          },
        }),
      ).toEqual({ sameChannelOnly: true });
    },
  );

  it("não interpreta texto truthy como same_channel_only", () => {
    expect(
      lerGuardasDaAutomacao({ automation_guards: { same_channel_only: "true" } }),
    ).toEqual({ sameChannelOnly: false });
  });
});
