import { describe, expect, it } from "vitest";

import { sql, lastLine } from "./gov-helpers";

/**
 * A 0233 COBRADA NO BANCO: APLICAR TEMPLATE NA ORGANIZAÇÃO A NÃO TOCA A B.
 *
 * ═══ Por que este arquivo é o mais importante do recurso ═══
 *
 * O caminho óbvio para "template de organização" é clonar uma organização que
 * ficou boa. Ele foi recusado no desenho porque clonar é um `select` em tabelas
 * que carregam contato, conversa, mensagem, credencial, sessão de WhatsApp e
 * webhook com segredo — e a lista de tabelas a excluir cresce a cada migration,
 * sozinha, sem ninguém ser avisado.
 *
 * O template é, em vez disso, configuração declarada em código
 * (`lib/templates/organizacao/`). Esta suíte é o que prova que a promessa é
 * real no banco, e não só na intenção de quem escreveu: que o conteúdo vem do
 * payload, que a escrita fica dentro da organização recebida, e que nada de
 * operacional atravessa.
 *
 * ⚠️ CADA CASO MONTA O PRÓPRIO PAR DE TENANTS. Um caso que herdasse a
 * organização já configurada pelo anterior mediria a precondição errada e
 * passaria por sorte.
 */

/** Um tenant com o funil que `trg_seed_default_pipeline_for_org` semeia. */
function criarTenant(slug: string): { org: string; pipeline: string } {
  const out = sql(`
    insert into public.organizations (slug, display_name, legal_name, status)
    values ('${slug}', '${slug}', '${slug}', 'active')
    on conflict (slug) do update set display_name = excluded.display_name;
    select o.id::text, p.id::text
      from public.organizations o
      join public.crm_pipelines p on p.organization_id = o.id and p.is_default
     where o.slug = '${slug}';
  `);
  const [org, pipeline] = lastLine(out).split("|");
  return { org: org ?? "", pipeline: pipeline ?? "" };
}

/** Um usuário que é platform admin de escopo completo — a função exige. */
function criarOperador(email: string): string {
  return lastLine(
    sql(`
      insert into auth.users (id, email)
      values (gen_random_uuid(), '${email}')
      on conflict (email) do update set email = excluded.email
      returning id::text;
      insert into public.platform_admins (user_id, granted_by, scope, mfa_required, reason)
      select id, id, 'full', false, 'Invariante 0233'
        from auth.users where email = '${email}'
      on conflict (user_id) do update
        set scope = 'full', revoked_at = null, mfa_required = false;
      select id::text from auth.users where email = '${email}';
    `),
  );
}

/**
 * O payload que a camada TypeScript monta (`payloadDoTemplate`), reduzido ao
 * que estes casos medem. Reproduzido aqui de propósito: o invariante é sobre o
 * CONTRATO da função do banco, e importar o catálogo faria o caso vermelhar
 * quando alguém só mudasse o texto de uma resposta pronta.
 */
const PAYLOAD = `'{
  "template_id": "clinica",
  "funil": {
    "nome": "Agendamentos",
    "slug": "agendamentos",
    "etapas": [
      {"nome":"Novo contato","slug":"novo_contato","position":1000,"is_won":false,"is_lost":false,"agent_stage_hint":"new"},
      {"nome":"Quer agendar","slug":"quer_agendar","position":2000,"is_won":false,"is_lost":false,"agent_stage_hint":"qualified"},
      {"nome":"Consulta marcada","slug":"consulta_marcada","position":3000,"is_won":true,"is_lost":false,"agent_stage_hint":"won"},
      {"nome":"Não agendou","slug":"nao_agendou","position":4000,"is_won":false,"is_lost":true,"agent_stage_hint":"lost"}
    ]
  },
  "vocabulario_do_funil": {"lead":"Paciente","won":"Agendado"},
  "settings_do_funil": {
    "fields": [{"key":"convenio","label":"Convênio","type":"text"}],
    "lost_reasons": ["Horário não encaixou"]
  },
  "tags_de_conversa": ["primeira-consulta","convenio"],
  "respostas_rapidas": [
    {"titulo":"Primeira resposta","corpo":"Olá! Qual atendimento você procura?","atalho":"oi"},
    {"titulo":"Oferecer horários","corpo":"Prefere manhã ou tarde?","atalho":null}
  ],
  "atendente": {
    "nome": "Atendente",
    "instrucoes": "Você atende quem procura a clínica.",
    "regras_da_casa": "Nunca dê diagnóstico."
  },
  "cadencias": [
    {
      "nome": "Interessado que não marcou",
      "proposito": "Retomar quem não agendou",
      "graph": {
        "nodes": [
          {"id":"inicio","type":"trigger","label":"Entrou","position":{"x":0,"y":0},"config":{}},
          {"id":"fim","type":"end","label":"Fim","position":{"x":240,"y":0},"config":{"outcome":"exhausted"}}
        ],
        "edges": [
          {"id":"inicio-fim","source":"inicio","target":"fim","priority":0,"condition":{"type":"always"}}
        ]
      }
    }
  ]
}'::jsonb`;

function aplicar(org: string, ator: string, payload = PAYLOAD): string {
  return lastLine(
    sql(`select public.fn_aplicar_template_de_organizacao(
           '${org}'::uuid, '${ator}'::uuid, ${payload})::text;`),
  );
}

describe("0233 · template de organização", () => {
  it("aplica no tenant A e não escreve UMA linha no tenant B", () => {
    const a = criarTenant("inv-0233-vaza-a");
    const b = criarTenant("inv-0233-vaza-b");
    const ator = criarOperador("op-0233-vaza@invariant.test");

    // O estado de B antes, em TODAS as tabelas que a função escreve. `ai_agents`
    // é UPDATE, não INSERT, e por isso uma contagem só das linhas novas não o
    // protegeria. `org_memory_versions` é a metade imutável da memória: medir só
    // o ponteiro deixaria passar uma versão criada na organização errada.
    const antesDeB = lastLine(
      sql(`select
             (select count(*) from public.crm_stages where organization_id='${b.org}'::uuid)::text || '|' ||
              (select count(*) from public.message_templates where organization_id='${b.org}'::uuid)::text || '|' ||
              (select count(*) from public.followup_flow_pointers where organization_id='${b.org}'::uuid)::text || '|' ||
              (select count(*) from public.org_memory_versions where organization_id='${b.org}'::uuid)::text || '|' ||
              (select coalesce(string_agg(id::text || '/' || name || '/' || system_prompt, ',' order by id), '') from public.ai_agents where organization_id='${b.org}'::uuid) || '|' ||
              (select count(*) from public.org_memory_pointers where organization_id='${b.org}'::uuid)::text || '|' ||
             (select coalesce(settings::text,'{}') from public.organizations where id='${b.org}'::uuid) || '|' ||
             (select name || '/' || slug from public.crm_pipelines where id='${b.pipeline}'::uuid);`),
    );

    expect(aplicar(a.org, ator)).toContain('"ok": true');

    const depoisDeB = lastLine(
      sql(`select
             (select count(*) from public.crm_stages where organization_id='${b.org}'::uuid)::text || '|' ||
              (select count(*) from public.message_templates where organization_id='${b.org}'::uuid)::text || '|' ||
              (select count(*) from public.followup_flow_pointers where organization_id='${b.org}'::uuid)::text || '|' ||
              (select count(*) from public.org_memory_versions where organization_id='${b.org}'::uuid)::text || '|' ||
              (select coalesce(string_agg(id::text || '/' || name || '/' || system_prompt, ',' order by id), '') from public.ai_agents where organization_id='${b.org}'::uuid) || '|' ||
              (select count(*) from public.org_memory_pointers where organization_id='${b.org}'::uuid)::text || '|' ||
             (select coalesce(settings::text,'{}') from public.organizations where id='${b.org}'::uuid) || '|' ||
             (select name || '/' || slug from public.crm_pipelines where id='${b.pipeline}'::uuid);`),
    );

    expect(depoisDeB, "aplicar template em A alterou o tenant B").toBe(antesDeB);
  });

  it("nada que o template escreve nasce com o organization_id errado", () => {
    // A outra metade do isolamento: não basta B ficar intacto, as linhas que
    // NASCERAM precisam todas pertencer a A. Uma linha com organização nula ou
    // alheia seria invisível para a RLS de qualquer tenant — órfã e permanente.
    const a = criarTenant("inv-0233-dono-a");
    criarTenant("inv-0233-dono-b");
    const ator = criarOperador("op-0233-dono@invariant.test");

    // Medido como DELTA, e não contando linhas pelo título do template: os casos
    // deste arquivo compartilham o banco, e uma contagem por título somaria as
    // respostas que o caso anterior criou na organização dele. A primeira versão
    // deste caso fazia isso e acusou 3 linhas "forasteiras" que eram do caso de
    // cima — um vermelho que falava da sonda, não da função.
    const contar = (escopo: string): number =>
      Number(
        lastLine(
          sql(`select (
                 (select count(*) from public.crm_stages ${escopo}) +
                 (select count(*) from public.message_templates ${escopo}) +
                 (select count(*) from public.followup_flow_pointers ${escopo}) +
                 (select count(*) from public.org_memory_versions ${escopo})
               )::text;`),
        ),
      );
    const deA = `where organization_id = '${a.org}'::uuid`;

    const globalAntes = contar("");
    const deAAntes = contar(deA);
    expect(aplicar(a.org, ator)).toContain('"ok": true');
    const globalDepois = contar("");
    const deADepois = contar(deA);

    // Se toda linha criada pertence a A, os dois saldos são IGUAIS. Uma linha com
    // organização nula, de B, ou de uma org inexistente faria o total global
    // variar mais que o de A.
    //
    // ⚠️ O saldo é NEGATIVO e isso é correto: o template troca as 8 etapas que o
    // gatilho semeia pelas 4 dele (-4), cria 2 respostas e 1 cadência, e fecha em
    // -1. A primeira versão deste caso exigia saldo POSITIVO como controle
    // positivo e vermelhava por isso, falando da sonda e não da função.
    expect(
      globalDepois - globalAntes,
      "linha criada fora da organização que recebeu o template",
    ).toBe(deADepois - deAAntes);

    // Controle positivo medido onde só há INSERÇÃO, para não se confundir com a
    // troca de etapas: sem isto, uma função que não escrevesse nada passaria.
    const criadas = Number(
      lastLine(
        sql(`select (
               (select count(*) from public.message_templates ${deA}) +
               (select count(*) from public.followup_flow_pointers ${deA})
             )::text;`),
      ),
    );
    expect(criadas, "o template não criou nada (sonda cega)").toBe(3);
  });

  it("não cria contato, conversa, mensagem, credencial, canal nem webhook", () => {
    // A razão de o template ser declarativo em vez de cópia de organização.
    // Este caso é a prova de que a fronteira existe no banco: se um dia alguém
    // adicionar um `insert` de dado operacional na função, ele vermelha aqui.
    const a = criarTenant("inv-0233-fronteira");
    const ator = criarOperador("op-0233-fronteira@invariant.test");

    expect(aplicar(a.org, ator)).toContain('"ok": true');

    const operacional = lastLine(
      sql(`select (
             (select count(*) from public.contacts where organization_id='${a.org}'::uuid) +
             (select count(*) from public.conversations where organization_id='${a.org}'::uuid) +
             (select count(*) from public.messages where organization_id='${a.org}'::uuid) +
             (select count(*) from public.crm_leads where organization_id='${a.org}'::uuid) +
             (select count(*) from public.ai_provider_credentials where organization_id='${a.org}'::uuid) +
             (select count(*) from public.channel_sessions where organization_id='${a.org}'::uuid) +
             (select count(*) from public.webhook_sources where organization_id='${a.org}'::uuid)
           )::text;`),
    );
    expect(operacional, "o template criou dado operacional — ele só pode criar configuração").toBe(
      "0",
    );
  });

  it("o atendente fica em RASCUNHO: o prompt entra, a versão publicada não", () => {
    // Publicar aqui poria no ar, falando com cliente final, um texto que ninguém
    // da empresa leu.
    const a = criarTenant("inv-0233-rascunho");
    const ator = criarOperador("op-0233-rascunho@invariant.test");

    sql(`
      insert into public.ai_agents (organization_id, name, system_prompt, kind, is_default, is_active)
      values ('${a.org}'::uuid, 'Atendente IA', 'prompt antigo', 'mcp_agent', true, true)
      on conflict do nothing;
    `);

    expect(aplicar(a.org, ator)).toContain('"atendente_aplicado": true');

    const estado = lastLine(
      sql(`select system_prompt || '|' || coalesce(published_version_id::text,'SEM-VERSAO')
             from public.ai_agents where organization_id='${a.org}'::uuid and is_default;`),
    );
    expect(estado).toBe("Você atende quem procura a clínica.|SEM-VERSAO");
  });

  it("as cadências entram DESLIGADAS e sem versão ativa", () => {
    // Cadência ativa num tenant recém-criado começa a mandar WhatsApp em nome de
    // um cliente que ainda não viu a mensagem.
    const a = criarTenant("inv-0233-desligada");
    const ator = criarOperador("op-0233-desligada@invariant.test");

    expect(aplicar(a.org, ator)).toContain('"cadencias_criadas": 1');

    const estado = lastLine(
      sql(`select status || '|' || coalesce(active_version_id::text,'SEM-VERSAO') || '|' ||
                  (select count(*)::text from public.followup_flow_versions where organization_id='${a.org}'::uuid)
             from public.followup_flow_pointers where organization_id='${a.org}'::uuid;`),
    );
    expect(estado).toBe("draft|SEM-VERSAO|0");
  });

  it("aplicar duas vezes não duplica resposta pronta nem cadência", () => {
    // Quem clica em "aplicar" e não vê a tela responder clica de novo.
    const a = criarTenant("inv-0233-idempotente");
    const ator = criarOperador("op-0233-idempotente@invariant.test");

    expect(aplicar(a.org, ator)).toContain('"ok": true');
    const segunda = aplicar(a.org, ator);
    expect(segunda).toContain('"ok": true');
    expect(segunda).toContain('"respostas_criadas": 0');
    expect(segunda).toContain('"cadencias_criadas": 0');

    const totais = lastLine(
      sql(`select
             (select count(*) from public.message_templates where organization_id='${a.org}'::uuid)::text || '|' ||
             (select count(*) from public.followup_flow_pointers where organization_id='${a.org}'::uuid)::text || '|' ||
             (select count(*) from public.crm_stages where organization_id='${a.org}'::uuid)::text;`),
    );
    expect(totais).toBe("2|1|4");
  });

  it("o segundo clique NÃO sobrescreve a cadência que alguém já editou", () => {
    // `on conflict do nothing` e não `do update`: o rascunho é trabalho humano a
    // partir do momento em que alguém abre o construtor.
    const a = criarTenant("inv-0233-nao-sobrescreve");
    const ator = criarOperador("op-0233-nao-sobrescreve@invariant.test");

    expect(aplicar(a.org, ator)).toContain('"ok": true');
    sql(`update public.followup_flow_pointers
            set draft_graph = jsonb_set(draft_graph, '{nodes,0,label}', '"Editado pela pessoa"')
          where organization_id='${a.org}'::uuid;`);

    aplicar(a.org, ator);

    expect(
      lastLine(
        sql(`select draft_graph->'nodes'->0->>'label'
               from public.followup_flow_pointers where organization_id='${a.org}'::uuid;`),
      ),
    ).toBe("Editado pela pessoa");
  });

  it("recusa funil que já tem negócio — template é para organização nova", () => {
    const a = criarTenant("inv-0233-com-negocio");
    const ator = criarOperador("op-0233-com-negocio@invariant.test");
    sql(`
      insert into public.crm_leads (organization_id, pipeline_id, stage_id, title, position_in_stage)
      select '${a.org}'::uuid, '${a.pipeline}'::uuid, s.id, 'Cliente de prova', 1000
        from public.crm_stages s
       where s.pipeline_id = '${a.pipeline}'::uuid order by s.position limit 1;
    `);
    const r = aplicar(a.org, ator);
    expect(r).toContain("funil_com_negocios");
    expect(r).toContain('"quantos": 1');

    // E a recusa é TOTAL: nada de resposta pronta criada "já que a gente estava aqui".
    expect(
      lastLine(
        sql(`select count(*)::text from public.message_templates where organization_id='${a.org}'::uuid;`),
      ),
    ).toBe("0");
  });

  it("recusa quem não é platform admin de escopo completo", () => {
    // A função é SECURITY DEFINER e passa por cima da RLS. Sem esta checagem,
    // qualquer chamada futura que esquecesse de conferir permissão reescreveria o
    // funil de um cliente.
    const a = criarTenant("inv-0233-sem-permissao");
    const comum = lastLine(
      sql(`insert into auth.users (id, email)
           values (gen_random_uuid(), 'op-0233-comum@invariant.test')
           on conflict (email) do update set email = excluded.email
           returning id::text;`),
    );

    let levantou = false;
    try {
      aplicar(a.org, comum);
    } catch {
      levantou = true;
    }
    expect(levantou, "a função precisa recusar quem não é platform admin").toBe(true);
  });

  it("recusa organização anonimizada por LGPD", () => {
    // Aplicar template reintroduziria configuração num tenant que foi apagado a
    // pedido.
    const a = criarTenant("inv-0233-redigida");
    const ator = criarOperador("op-0233-redigida@invariant.test");
    sql(`update public.organizations set redacted_at = now() where id='${a.org}'::uuid;`);
    expect(aplicar(a.org, ator)).toContain("organizacao_nao_encontrada");
  });
});
