import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { NAV_DESTINATIONS, NAV_GROUPS } from "@/lib/navigation/registry";

/**
 * O teste que impede a bagunça de voltar.
 *
 * O Living System Checklist já perguntava "onde eu apareço na tela?" — e todas
 * as features respondiam "tenho tela" e passavam. Nenhuma era obrigada a
 * responder POR QUAL PORTA se chega nela. O resultado foram sete telas
 * alcançáveis só por dentro da própria seção e duas sem link nenhum no app.
 *
 * Aqui isso vira mecânico. Rota sem porta reprova o CI; entrada de registro
 * apontando para rota inexistente também.
 *
 * ESCOPO: só `app/app/**` — a navegação do tenant. O admin de plataforma
 * (`app/admin/`), o onboarding e as páginas públicas têm navegação própria.
 */

const RAIZ = process.cwd();
const BASE = path.join(RAIZ, "app", "app");

/**
 * Rotas que existem mas NÃO são destino de navegação.
 *
 * Toda entrada carrega o porquê. É o que separa uma decisão registrada de um
 * esquecimento: quem adicionar uma linha aqui tem de escrever a justificativa,
 * e quem revisar o PR a lê.
 */
const NAV_ALLOWLIST: Record<string, string> = {
  "/app/crm":
    "hub legado preservado para links salvos; por decisão do dono em 17/09/2026 o CRM ficou sem hub e mostra somente Funis, Contatos e Tarefas no menu",
  "/app/ai":
    "hub legado preservado para links salvos; por decisão do dono em 17/09/2026 o grupo mostra Atendimento, Casos e Alertas diretamente no menu",
  "/app/analise":
    "hub legado preservado para links salvos; por decisão do dono em 18/09/2026 Análise mostra somente Relatório no menu",
  "/app/metrics":
    "redirect legado para /app/resultados; mantido para links salvos e integrações que ainda usam a URL anterior",
  "/app": "redirect para /app/inbox — não é tela, é o ponto de entrada",
  "/app/ai/agents/new":
    "sub-fluxo de criar agente, alcançado pelo botão dentro da lista de Agentes",
  "/app/team/invite": "sub-fluxo de convite, alcançado de dentro de Equipe",
  "/app/settings/tenant/whatsapp": "redirect legado para /app/connections; mantido por links salvos",
  "/app/settings/canal-oficial":
    "redirect para /app/connections?aba=oficial desde o PR #105 — conectar canal passou a ter um lugar só. Conexões é a porta; a aba é navegação interna dela",
  "/app/settings/templates":
    "redirect para /app/connections?aba=oficial&sub=templates — template da Meta só existe por causa do canal oficial, e vive como sub-aba dele",
  "/app/settings/atualizacao":
    "porta é o rodapé de versão (VersionFooter), que aparece justamente quando há versão nova — melhor que um card fixo. Além disso é só do dono do servidor (is_platform_admin), papel que o registro não modela",
};

/** Deriva as rotas estáticas a partir dos arquivos de página que existem. */
function rotasNoDisco(dir: string, prefixo = "/app"): string[] {
  const rotas: string[] = [];
  for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entrada.isFile() && entrada.name === "page.tsx") rotas.push(prefixo);
    if (!entrada.isDirectory()) continue;
    // `_components` e afins não são segmentos de rota; `[id]` é tela de detalhe,
    // alcançada a partir de uma lista — nunca um item de menu.
    if (entrada.name.startsWith("_") || entrada.name.startsWith("[")) continue;
    rotas.push(...rotasNoDisco(path.join(dir, entrada.name), `${prefixo}/${entrada.name}`));
  }
  return rotas;
}

const ROTAS = rotasNoDisco(BASE).sort();
const NO_REGISTRO = new Set(NAV_DESTINATIONS.map((d) => d.href));
const HUBS = NAV_GROUPS.flatMap((g) => (g.hub ? [g.hub.href] : []));

/**
 * O registro cobre a entrada na tela. Retornos determinísticos são a direção
 * inversa e também navegam o usuário, mas vivem dentro das páginas de detalhe
 * em vez do catálogo. Extraímos apenas `Voltar href="/rota-estática"`: hrefs
 * dinâmicos continuam fora deste contrato e precisam de teste de fluxo próprio.
 */
function retornosDeterministicosNoDisco(dir: string): Array<{ arquivo: string; href: string }> {
  const retornos: Array<{ arquivo: string; href: string }> = [];
  for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
    const arquivo = path.join(dir, entrada.name);
    if (entrada.isDirectory()) {
      retornos.push(...retornosDeterministicosNoDisco(arquivo));
      continue;
    }
    if (!entrada.isFile() || !/\.(?:ts|tsx)$/.test(entrada.name)) continue;
    const conteudo = fs.readFileSync(arquivo, "utf8");
    for (const match of conteudo.matchAll(/<Voltar\s+href=["'](\/app\/[\w/-]+)["']/g)) {
      const href = match[1];
      if (href) retornos.push({ arquivo: path.relative(RAIZ, arquivo), href });
    }
  }
  return retornos;
}

const RETORNOS = retornosDeterministicosNoDisco(path.join(RAIZ, "app"));

describe("completude da navegação", () => {
  it("encontrou as rotas do app — se isto zerar, o resto do arquivo não prova nada", () => {
    expect(ROTAS.length).toBeGreaterThan(20);
  });

  it("toda tela tem porta: está no registro ou na allowlist justificada", () => {
    // Um hub é porta tanto quanto um destino — o sidebar linka para ele. Ele só
    // não é `NavDestination` porque não é uma tela do grupo, e sim a vitrine dele.
    const semPorta = ROTAS.filter(
      (r) => !NO_REGISTRO.has(r) && !HUBS.includes(r) && !(r in NAV_ALLOWLIST),
    );
    expect(
      semPorta,
      `Tela sem porta — existe mas não se chega nela pela navegação.\n` +
        `Adicione ao registro (lib/navigation/registry.ts) declarando grupo, ou\n` +
        `à NAV_ALLOWLIST deste arquivo COM a justificativa:\n  ${semPorta.join("\n  ")}`,
    ).toEqual([]);
  });

  it("todo destino do registro aponta para uma tela que existe", () => {
    const mortos = NAV_DESTINATIONS.map((d) => d.href).filter((h) => !ROTAS.includes(h));
    expect(mortos, `Link morto no registro:\n  ${mortos.join("\n  ")}`).toEqual([]);
  });

  it("todo hub de grupo aponta para uma tela que existe", () => {
    const mortos = HUBS.filter((h) => !ROTAS.includes(h));
    expect(mortos, `Hub apontando para rota inexistente:\n  ${mortos.join("\n  ")}`).toEqual([]);
  });

  it("todo retorno determinístico aponta para uma tela que existe", () => {
    const mortos = RETORNOS.filter(({ href }) => !ROTAS.includes(href));
    expect(
      mortos,
      `Voltar apontando para rota inexistente:\n  ${mortos
        .map(({ arquivo, href }) => `${arquivo} → ${href}`)
        .join("\n  ")}`,
    ).toEqual([]);
  });

  it("a allowlist não guarda rota que já morreu", () => {
    const obsoletas = Object.keys(NAV_ALLOWLIST).filter((r) => !ROTAS.includes(r));
    expect(obsoletas, `Allowlist cita rota que não existe mais:\n  ${obsoletas.join("\n  ")}`).toEqual(
      [],
    );
  });

  it("toda entrada da allowlist explica o porquê", () => {
    const semJustificativa = Object.entries(NAV_ALLOWLIST)
      .filter(([, motivo]) => motivo.trim().length < 20)
      .map(([rota]) => rota);
    expect(semJustificativa).toEqual([]);
  });
});
