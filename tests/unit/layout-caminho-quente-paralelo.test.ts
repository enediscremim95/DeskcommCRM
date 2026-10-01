import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("caminho quente do layout autenticado", () => {
  const layout = readFileSync("app/app/layout.tsx", "utf8");
  const auth = readFileSync("lib/auth/server.ts", "utf8");

  it("decide a organização ativa antes de iniciar leituras independentes", () => {
    const resolve = layout.indexOf("await resolveActiveOrg(user)");
    const revogacao = layout.indexOf("await acessoFoiRevogado(user.id)");
    const primeiraParalela = layout.indexOf("const storePromise = cookies()");

    expect(resolve).toBeGreaterThan(-1);
    expect(revogacao).toBeGreaterThan(resolve);
    expect(primeiraParalela).toBeGreaterThan(revogacao);
  });

  it("consulta administração, vínculos e suporte em paralelo sem tirar a ordenação", () => {
    expect(auth).toMatch(
      /Promise\.all\(\[\s*platformAdminPromise,\s*membershipsPromise,\s*readSupportContext/,
    );
    expect(auth).toMatch(
      /\.order\("accepted_at"[\s\S]*\.order\("organization_id"/,
    );
  });

  it("reúne as leituras independentes do tenant no mesmo lote", () => {
    expect(layout).toMatch(
      /Promise\.all\(\[\s*orgRowPromise,\s*integrationAccessPromise,\s*marcaDaInstalacaoPromise,\s*conexoesCaidasPromise,\s*storePromise,\s*enrolledPromise,\s*needsMfaPromise/,
    );
  });

  it("reusa organizations.settings na MFA e não consulta saúde antes da permissão", () => {
    expect(layout).toMatch(
      /organizationSettings:\s*orgRowPromise\.then\(\(row\) => row\?\.settings\)/,
    );
    expect(layout).toMatch(
      /const access = await integrationAccessPromise;[\s\S]*access\.whatsapp\.client_visible[\s\S]*await listarConexoesCaidas/,
    );
  });
});
