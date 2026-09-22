import { describe, expect, it } from "vitest";

import { generateProvisionalPassword } from "./provisional-password";

describe("senha provisória do convite", () => {
  it("gera 12 caracteres com maiúscula, minúscula e número, sem ambíguos", () => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const password = generateProvisionalPassword();
      expect(password).toHaveLength(12);
      expect(password).toMatch(/[A-Z]/);
      expect(password).toMatch(/[a-z]/);
      expect(password).toMatch(/[2-9]/);
      expect(password).not.toMatch(/[O0l1]/);
    }
  });
});
