import { describe, expect, it } from "vitest";

import {
  NAV_DESTINATIONS,
  NAV_GROUPS,
  canSee,
  hubSections,
  searchable,
  sidebarGroups,
} from "@/lib/navigation/registry";

/**
 * O registro é a fonte única da navegação. Estes testes cobrem as projeções
 * puras — quem renderiza (sidebar, hub, ⌘K) não decide nada, só desenha o que
 * sai daqui. A completude do registro contra as rotas de verdade é assunto de
 * `navegacao-completude.test.ts`.
 */

const ADMIN = { platform: false, role: "admin" as const };
const MANAGER = { platform: false, role: "manager" as const };
const AGENT = { platform: false, role: "agent" as const };
const VIEWER = { platform: false, role: "viewer" as const };

function dest(href: string) {
  const d = NAV_DESTINATIONS.find((x) => x.href === href);
  if (!d) throw new Error(`destino ausente do registro: ${href}`);
  return d;
}

describe("integridade do registro", () => {
  it("não tem href duplicado", () => {
    const vistos = new Map<string, number>();
    for (const d of NAV_DESTINATIONS) vistos.set(d.href, (vistos.get(d.href) ?? 0) + 1);
    const duplicados = [...vistos.entries()].filter(([, n]) => n > 1).map(([href]) => href);
    expect(duplicados).toEqual([]);
  });

  it("todo destino aponta para um grupo declarado", () => {
    const ids = new Set(NAV_GROUPS.map((g) => g.id));
    const orfaos = NAV_DESTINATIONS.filter((d) => !ids.has(d.group)).map((d) => d.href);
    expect(orfaos).toEqual([]);
  });

  it("todo destino tem descrição — é o que o hub e o ⌘K mostram", () => {
    const semTexto = NAV_DESTINATIONS.filter((d) => d.description.trim() === "").map((d) => d.href);
    expect(semTexto).toEqual([]);
  });

  it("todo destino de um grupo com hub declara sua seção", () => {
    const comHub = new Set(NAV_GROUPS.filter((g) => g.hub).map((g) => g.id));
    const semSecao = NAV_DESTINATIONS.filter((d) => comHub.has(d.group) && !d.section).map(
      (d) => d.href,
    );
    expect(semSecao).toEqual([]);
  });
});

describe("canSee", () => {
  it("nega quem está abaixo do minRole", () => {
    expect(canSee(dest("/app/audit"), MANAGER.platform, MANAGER.role)).toBe(true);
    expect(canSee(dest("/app/audit"), AGENT.platform, AGENT.role)).toBe(false);
  });

  it("destino sem minRole é visível até para viewer", () => {
    expect(canSee(dest("/app/inbox"), VIEWER.platform, VIEWER.role)).toBe(true);
  });

  it("platform admin vê tudo, inclusive sem org ativa", () => {
    for (const d of NAV_DESTINATIONS) expect(canSee(d, true, null)).toBe(true);
  });

  it("sem papel e sem ser platform admin não vê nada", () => {
    expect(canSee(dest("/app/inbox"), false, null)).toBe(false);
  });
});

describe("sidebarGroups", () => {
  it("devolve os grupos na ordem declarada em NAV_GROUPS", () => {
    const ordem = sidebarGroups(true, null).map((g) => g.group.id);
    const esperada = NAV_GROUPS.map((g) => g.id).filter((id) => ordem.includes(id));
    expect(ordem).toEqual(esperada);
  });

  it("só inclui destino marcado como sidebar", () => {
    const hrefs = sidebarGroups(true, null).flatMap((g) => g.items.map((i) => i.href));
    expect(hrefs).toContain("/app/ai/atendimento");
    // Conhecimento saiu do menu junto com as outras telas de ajuste fino: o
    // fluxo do atendimento é a porta delas agora. O n8n continua fora.
    expect(hrefs).not.toContain("/app/ai/knowledge/sources");
    expect(hrefs).not.toContain("/app/ai/workflows");
  });

  it("Etapas do funil é CRM, não Configurações — o achado que originou esta mudança", () => {
    // ⚠️ ESTA ASSERÇÃO MUDOU DE SUPERFÍCIE, e a propriedade guardada é a mesma.
    // Ela cobrava presença no SIDEBAR, que era só o jeito de a tela deixar de
    // ser "um card perdido em Configurações". Depois da retirada do hub do CRM
    // em 17/09/2026, ela continua sendo CRM, fora de Configurações e disponível
    // no ⌘K. `hubSections` aqui verifica a classificação do catálogo, não uma
    // porta que ainda apareça na interface.
    //
    // O que NÃO pode voltar é o destino trocar de grupo: é isso que a primeira
    // asserção prende, e ela não depende de onde o item é desenhado.
    expect(dest("/app/settings/tenant/pipelines").group).toBe("crm");
    const hub = hubSections("crm", true, null).flatMap((s) => s.items.map((i) => i.href));
    expect(hub).toContain("/app/settings/tenant/pipelines");
  });

  it("o CRM ficou sem hub, e o sidebar dele mostra só as três portas escolhidas", () => {
    // Decisão do dono em 17/09/2026: o hub saiu e o grupo ficou limitado a
    // Funis, Contatos e Tarefas. As demais telas seguem no registro e no ⌘K;
    // este teste não pode continuar ressuscitando a navegação anterior.
    //
    // A lista é EXATA de propósito. `toContain` deixaria um sexto item entrar
    // calado no sidebar e reabrir a mesma corrida por pixel.
    const crm = sidebarGroups(true, null).find((g) => g.group.id === "crm");
    expect(crm?.items.map((i) => i.href)).toEqual([
      "/app/kanban",
      "/app/contacts",
      "/app/tasks",
    ]);
    expect(NAV_GROUPS.find((g) => g.id === "crm")?.hub).toBeUndefined();
  });

  it("omite o grupo inteiro quando o papel não vê nenhum item dele", () => {
    // CANAIS é todo manager+/admin: um agent não deve ver o título órfão.
    const ids = sidebarGroups(AGENT.platform, AGENT.role).map((g) => g.group.id);
    expect(ids).not.toContain("canais");
    expect(ids).toContain("atendimento");
  });

  it("o grupo de IA fica com o fluxo e a operação do dia", () => {
    // Eram oito portas, e quem chegava precisava entender a arquitetura do
    // produto antes de atender um cliente (medido: zero agentes criados em 24
    // organizações). Agora o atendimento é UM fluxo no canvas, e Casos e
    // Alertas ficam porque são operação do dia, não configuração. As telas de
    // ajuste fino continuam existindo, alcançáveis pelo fluxo e pela busca.
    const ia = sidebarGroups(true, null).find((g) => g.group.id === "ia");
    expect(ia?.items.map((i) => i.href)).toEqual([
      "/app/ai/atendimento",
      "/app/ai/cases",
      "/app/ai/inbox",
    ]);
  });

  it("mantém o N8N fora do menu, mas alcançável pela busca", () => {
    const menu = sidebarGroups(true, null).flatMap((g) => g.items.map((i) => i.href));
    const busca = searchable(true, null).map((i) => i.href);
    expect(menu).not.toContain("/app/ai/workflows");
    expect(busca).toContain("/app/ai/workflows");
  });
});

describe("hubSections", () => {
  it("o catálogo do CRM preserva as cinco telas nas duas seções", () => {
    // As seções são a régua do sidebar escrita por extenso — o que se abre todo
    // dia contra o que se define uma vez. Lista EXATA: `toContain` deixaria uma
    // tela nova entrar sem que ninguém decidisse de que lado dela ela cai.
    const secoes = hubSections("crm", true, null);
    expect(secoes.map((s) => s.section)).toEqual(["O dia a dia da venda", "Preparar a venda"]);
    expect(secoes.flatMap((s) => s.items.map((i) => i.href))).toEqual([
      "/app/kanban",
      "/app/contacts",
      "/app/tasks",
      "/app/products",
      "/app/settings/tenant/pipelines",
    ]);
  });

  it("agrupa a IA nas três etapas da jornada, na ordem", () => {
    const secoes = hubSections("ia", true, null).map((s) => s.section);
    expect(secoes).toEqual(["Montar o agente", "Ensinar o agente", "Acompanhar o agente"]);
  });

  it("o hub mostra também o que já está no sidebar — é inventário, não sobra", () => {
    const hrefs = hubSections("ia", true, null).flatMap((s) => s.items.map((i) => i.href));
    expect(hrefs).toContain("/app/ai/agents");
    expect(hrefs).toContain("/app/ai/knowledge/sources");
  });

  it("não vaza destino acima do papel", () => {
    const hrefs = hubSections("organizacao", VIEWER.platform, VIEWER.role).flatMap((s) =>
      s.items.map((i) => i.href),
    );
    expect(hrefs).not.toContain("/app/settings/api-tokens");
    expect(hrefs).toContain("/app/settings/profile");
  });

  it("some com a seção que ficou vazia pela permissão", () => {
    const secoes = hubSections("organizacao", VIEWER.platform, VIEWER.role).map((s) => s.section);
    expect(secoes).not.toContain("Dados e acesso");
  });
});

describe("searchable", () => {
  it("expõe todo destino visível, do sidebar ou não", () => {
    const hrefs = searchable(ADMIN.platform, ADMIN.role).map((d) => d.href);
    expect(hrefs).toContain("/app/ai/knowledge/sources");
    expect(hrefs).toContain("/app/inbox");
  });

  it("respeita o papel", () => {
    const hrefs = searchable(AGENT.platform, AGENT.role).map((d) => d.href);
    expect(hrefs).not.toContain("/app/audit");
  });
});
