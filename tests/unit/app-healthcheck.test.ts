import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const RAIZ = process.cwd();
const compose = fs.readFileSync(path.join(RAIZ, "docker-compose.prod.yml"), "utf8");
const SONDA_TCP =
  "test: [\"CMD\", \"node\", \"-e\", \"require('net').connect(3000,'127.0.0.1').on('connect',()=>process.exit(0)).on('error',()=>process.exit(1))\"]";

function blocoDoApp(): string {
  const bloco = compose.match(/^  app:\r?\n[\s\S]*?(?=^  [a-z][a-z0-9-]*:\r?$)/m)?.[0];
  if (!bloco) throw new Error("serviço app não encontrado no compose de produção");
  return bloco;
}

function blocoDoHealthcheck(): string {
  const bloco = blocoDoApp().match(
    /^    healthcheck:\r?\n[\s\S]*?(?=^    [a-z][a-z0-9_-]*:|^  [a-z][a-z0-9-]*:)/m,
  )?.[0];
  if (!bloco) throw new Error("healthcheck do app não encontrado no compose de produção");
  return bloco;
}

describe("healthcheck do container app", () => {
  it("mede somente se o processo aceita conexão TCP na porta 3000", () => {
    const healthcheck = blocoDoHealthcheck();
    const comando = healthcheck
      .split(/\r?\n/)
      .find((linha) => linha.trimStart().startsWith("test:"));

    expect(comando, "o healthcheck do app ficou sem comando").toBeDefined();
    expect(comando?.trim()).toBe(SONDA_TCP);
    expect(comando).not.toMatch(/api\/v1\/health|app-healthcheck\.mjs|fetch\(|supabase|redis|waha/i);
  });

  it("preserva a tolerância operacional e não empacota a sonda antiga", () => {
    const healthcheck = blocoDoHealthcheck();
    const dockerfile = fs.readFileSync(path.join(RAIZ, "Dockerfile"), "utf8");

    expect(healthcheck).toContain("interval: 30s");
    expect(healthcheck).toContain("timeout: 5s");
    expect(healthcheck).toContain("retries: 5");
    expect(healthcheck).toContain("start_period: 40s");
    expect(dockerfile).not.toContain("app-healthcheck.mjs");
    expect(fs.existsSync(path.join(RAIZ, "docker", "app-healthcheck.mjs"))).toBe(false);
  });
});
