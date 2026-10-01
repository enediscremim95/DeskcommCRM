import { spawn } from "node:child_process";
import fs from "node:fs";
import { createServer, type Server } from "node:http";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const servidores: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servidores.splice(0).map(
      (server) => new Promise<void>((resolve) => server.close(() => resolve())),
    ),
  );
});

async function servidorDeSaude(statusBanco: "ok" | "down", httpStatus: number) {
  let cabecalhos: Record<string, string | string[] | undefined> = {};
  const server = createServer((req, res) => {
    cabecalhos = req.headers;
    res.writeHead(httpStatus, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        data: {
          status: httpStatus === 200 ? "healthy" : "unhealthy",
          checks: { supabase: { status: statusBanco } },
        },
      }),
    );
  });
  servidores.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("servidor de teste sem porta");
  return {
    url: `http://127.0.0.1:${address.port}/api/v1/health`,
    cabecalhos: () => cabecalhos,
  };
}

async function executarProbe(url: string): Promise<number | null> {
  const script = path.join(process.cwd(), "docker", "app-healthcheck.mjs");
  return new Promise((resolve, reject) => {
    const filho = spawn(process.execPath, [script, url], {
      env: { ...process.env, INTERNAL_SECRET: "segredo-do-healthcheck" },
      stdio: "ignore",
    });
    filho.once("error", reject);
    filho.once("exit", resolve);
  });
}

describe("healthcheck do container app", () => {
  it("o compose executa a sonda que a imagem realmente carrega e a rota publica o estado", () => {
    const compose = fs.readFileSync(path.join(process.cwd(), "docker-compose.prod.yml"), "utf8");
    const dockerfile = fs.readFileSync(path.join(process.cwd(), "Dockerfile"), "utf8");
    const rota = fs.readFileSync(
      path.join(process.cwd(), "app", "api", "v1", "health", "route.ts"),
      "utf8",
    );

    expect(compose).toContain('["CMD", "node", "/opt/app-healthcheck.mjs"]');
    expect(dockerfile).toContain("docker/app-healthcheck.mjs /opt/app-healthcheck.mjs");
    expect(rota).toContain('check.code === "PGRST003"');
    expect(rota).toContain("auto_cura_banco: autoCura.estado");
  });

  it("aprova quando o banco responde, mesmo se outra dependência deixou a rota em 503", async () => {
    const servidor = await servidorDeSaude("ok", 503);

    expect(await executarProbe(servidor.url)).toBe(0);
    expect(servidor.cabecalhos()["x-self-heal-probe"]).toBe("1");
    expect(servidor.cabecalhos().authorization).toBe("Bearer segredo-do-healthcheck");
  });

  it("reprova quando o banco não responde", async () => {
    const servidor = await servidorDeSaude("down", 503);

    expect(await executarProbe(servidor.url)).toBe(1);
  });
});
