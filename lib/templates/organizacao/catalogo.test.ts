import { describe, expect, it } from "vitest";

import { flowGraphSchema } from "@/lib/followup/graph-schema";
import { PACOTES } from "@/lib/onboarding/pacotes-de-funil";

import { TEMPLATES, acharTemplate } from "./catalogo";
import { grafoDaCadencia, payloadDoTemplate } from "./aplicacao";
import { templateDeOrganizacaoSchema } from "./tipos";

describe("catálogo de templates de organização", () => {
  it("todo template passa pelo próprio schema", () => {
    // Os três já são `parse`ados no módulo, então isto cobre o dia em que
    // alguém acrescentar um quarto por outro caminho.
    for (const t of TEMPLATES) {
      expect(() => templateDeOrganizacaoSchema.parse(t), t.id).not.toThrow();
    }
  });

  it("não existem dois templates com o mesmo id", () => {
    const ids = TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("todo template aponta para um pacote de funil que existe", () => {
    // A proteção contra renomear um pacote no onboarding e deixar o template
    // apontando para o vazio — o que daria funil sem coluna nenhuma.
    const conhecidos = new Set(PACOTES.map((p) => p.id));
    for (const t of TEMPLATES) {
      expect(conhecidos.has(t.pacoteDeFunil), `${t.id} -> ${t.pacoteDeFunil}`).toBe(true);
    }
  });

  it("acharTemplate devolve undefined para id desconhecido, nunca o primeiro da lista", () => {
    expect(acharTemplate("nao-existe")).toBeUndefined();
    expect(acharTemplate("clinica")?.id).toBe("clinica");
  });

  it("nenhum template traz chave, modelo ou credencial de IA", () => {
    // `strictObject` no schema já recusaria, e o caso existe porque a tentação é
    // real: seria cômodo o template já vir com provedor e modelo configurados, e
    // a conta chegaria para quem escreveu o template.
    const bruto = JSON.stringify(TEMPLATES);
    for (const proibido of ["api_key", "apiKey", "credential", "provider", "sk-"]) {
      expect(bruto.includes(proibido), `template menciona "${proibido}"`).toBe(false);
    }
  });

  it("cada atalho de resposta pronta é único dentro do template", () => {
    // Dois atalhos iguais fazem o inbox puxar um texto imprevisível.
    for (const t of TEMPLATES) {
      const atalhos = t.respostasRapidas.map((r) => r.atalho).filter(Boolean);
      expect(new Set(atalhos).size, t.id).toBe(atalhos.length);
    }
  });

  it("cada chave de campo personalizado é única dentro do template", () => {
    for (const t of TEMPLATES) {
      const chaves = t.campos.map((c) => c.key);
      expect(new Set(chaves).size, t.id).toBe(chaves.length);
    }
  });
});

describe("tradução do template para o banco", () => {
  it("o funil sai com uma única etapa de ganho e uma única de perda", () => {
    // `uniq_crm_stages_pipeline_won` e a irmã dela são imediatas: duas etapas de
    // ganho fazem a função do banco levantar e desfazer a transação inteira.
    for (const t of TEMPLATES) {
      const p = payloadDoTemplate(t);
      expect(p.funil.etapas.filter((e) => e.is_won).length, t.id).toBe(1);
      expect(p.funil.etapas.filter((e) => e.is_lost).length, t.id).toBe(1);
    }
  });

  it("os slugs das etapas não colidem dentro do funil", () => {
    for (const t of TEMPLATES) {
      const slugs = payloadDoTemplate(t).funil.etapas.map((e) => e.slug);
      expect(new Set(slugs).size, t.id).toBe(slugs.length);
    }
  });

  it("toda etapa ensina o destino ao assistente", () => {
    // Sem `agent_stage_hint`, `coberturaDoFunil()` devolve mudo e o assistente
    // não move um card — seria trocar um funil errado por um funil certo e
    // igualmente parado.
    for (const t of TEMPLATES) {
      for (const e of payloadDoTemplate(t).funil.etapas) {
        expect(e.agent_stage_hint, `${t.id}/${e.slug}`).toBeTruthy();
      }
    }
  });

  it("o slug do funil desvia de um slug já usado na organização", () => {
    const clinica = acharTemplate("clinica")!;
    const livre = payloadDoTemplate(clinica).funil.slug;
    const ocupado = payloadDoTemplate(clinica, [livre]).funil.slug;
    expect(ocupado).not.toBe(livre);
  });

  it("todo grafo de cadência é válido para o motor de follow-up", () => {
    for (const t of TEMPLATES) {
      for (const c of t.cadencias) {
        const r = flowGraphSchema.safeParse(grafoDaCadencia(c));
        expect(r.success, `${t.id}/${c.nome}: ${r.success ? "" : JSON.stringify(r.error.issues)}`).toBe(
          true,
        );
      }
    }
  });

  it("o grafo da cadência é linear e fecha no nó final", () => {
    const grafo = grafoDaCadencia({
      nome: "Duas mensagens",
      proposito: "Provar a forma",
      passos: [
        { esperarMinutos: 1440, texto: "primeira" },
        { esperarMinutos: 2880, texto: "segunda" },
      ],
    });

    // trigger + (espera + mensagem) * 2 + fim
    expect(grafo.nodes).toHaveLength(6);
    expect(grafo.nodes.at(0)?.type).toBe("trigger");
    expect(grafo.nodes.at(-1)?.type).toBe("end");
    // Linear: toda aresta é incondicional, e são N-1.
    expect(grafo.edges).toHaveLength(5);
    expect(grafo.edges.every((e) => e.condition.type === "always")).toBe(true);

    // Todo nó, menos o disparo, é alcançado por exatamente uma aresta.
    const alvos = grafo.edges.map((e) => e.target);
    expect(new Set(alvos).size).toBe(grafo.nodes.length - 1);
  });

  it("a cadência termina como esgotada, não como convertida", () => {
    // Marcar conversão no fim poluiria a estatística do fluxo com todo mundo que
    // simplesmente não respondeu.
    const grafo = grafoDaCadencia({
      nome: "Uma mensagem",
      proposito: "Provar o desfecho",
      passos: [{ esperarMinutos: 60, texto: "oi" }],
    });
    const fim = grafo.nodes.at(-1);
    expect(fim?.type === "end" && fim.config.outcome).toBe("exhausted");
  });

  it("a espera respeita o piso de 5 minutos do motor", () => {
    // `waitConfigSchema` recusa abaixo de 300_000 ms. O schema do template já
    // exige 5 minutos; este caso prova que a conversão para ms não perde o piso.
    for (const t of TEMPLATES) {
      for (const c of t.cadencias) {
        for (const no of grafoDaCadencia(c).nodes) {
          if (no.type !== "wait" || no.config.mode !== "fixed") continue;
          expect(no.config.duration_ms, `${t.id}/${c.nome}`).toBeGreaterThanOrEqual(300_000);
        }
      }
    }
  });

  it("vocabulário vazio não viaja como chave vazia", () => {
    // Uma chave com string vazia em `crm_pipelines.vocabulary` apagaria o rótulo
    // que o produto mostra, em vez de deixá-lo como está.
    for (const t of TEMPLATES) {
      const v = payloadDoTemplate(t).vocabulario_do_funil;
      expect(Object.values(v).every((x) => x.length > 0), t.id).toBe(true);
    }
  });
});
