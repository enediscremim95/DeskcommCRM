import { execFileSync } from "node:child_process";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const container = process.env.TEST_DB_CONTAINER;
if (!container) {
  throw new Error("TEST_DB_CONTAINER not set, rode via pnpm test:db");
}
const containerName: string = container;

function sql(script: string): string {
  return execFileSync(
    "docker",
    [
      "exec",
      "-i",
      containerName,
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-q",
      "-tA",
      "-f",
      "-",
    ],
    { input: script, encoding: "utf8" },
  ).trim();
}

const ORG = "a2590000-0000-4000-8000-000000000001";
const USER = "a2590000-0000-4000-8000-000000000002";
const PIPELINE = "a2590000-0000-4000-8000-000000000003";
const STAGE = "a2590000-0000-4000-8000-000000000004";

beforeAll(() => {
  sql(`
    insert into auth.users (id, email) values ('${USER}', 'resumo-urgencia@test.local')
      on conflict (id) do nothing;
    insert into public.organizations (id, slug, display_name, legal_name, settings)
      values ('${ORG}', 'resumo-urgencia-test', 'Resumo Urgência', 'Resumo Urgência',
        '{"notifications":{"email":{"urgent_batch_window_minutes":60,"urgent_daily_limit":6}}}'::jsonb)
      on conflict (id) do update set settings = excluded.settings;
    insert into public.user_organizations (organization_id, user_id, role)
      values ('${ORG}', '${USER}', 'admin') on conflict do nothing;
    insert into public.crm_pipelines (id, organization_id, name, slug)
      values ('${PIPELINE}', '${ORG}', 'Comercial', 'comercial') on conflict (id) do nothing;
    insert into public.crm_stages (id, organization_id, pipeline_id, name, slug, position)
      values ('${STAGE}', '${ORG}', '${PIPELINE}', 'Negociação', 'negociacao', 1000)
      on conflict (id) do nothing;
  `);
});

afterAll(() => {
  sql(`
    delete from public.organizations where id = '${ORG}';
    delete from auth.users where id = '${USER}';
  `);
});

describe("resumo de urgência por pessoa", () => {
  it("mantém o e-mail de lead novo desligado por padrão no banco", () => {
    // Decisão do dono em 25/09/2026: 28 leads x 3 pessoas geraram 84 e-mails
    // num plano de 100/dia, o mesmo que sustenta convite e recuperação de senha.
    // O opt-in continua possível, mas uma preferência nova não pode nascer ligada.
    const result = sql(`
      delete from public.notification_email_preferences
       where organization_id = '${ORG}' and user_id = '${USER}';
      insert into public.notification_email_preferences (organization_id, user_id)
      values ('${ORG}', '${USER}');
      select p.new_lead::text || '|' || (c.column_default = 'false')::text
        from public.notification_email_preferences p
        join information_schema.columns c
          on c.table_schema = 'public'
         and c.table_name = 'notification_email_preferences'
         and c.column_name = 'new_lead'
       where p.organization_id = '${ORG}' and p.user_id = '${USER}';
    `);
    expect(result).toBe("false|true");
  });

  it("agrupa 20 leads urgentes, não repete a mesma situação e adia após o teto", () => {
    const result = sql(`
      do $$
      declare i integer; lead_id uuid; event_id uuid;
      begin
        for i in 1..20 loop
          lead_id := ('a2590000-0000-4000-8000-' || lpad((100 + i)::text, 12, '0'))::uuid;
          event_id := ('a2590000-0000-4000-8001-' || lpad((100 + i)::text, 12, '0'))::uuid;
          insert into public.crm_leads
            (id, organization_id, pipeline_id, stage_id, title, owner_user_id)
          values (lead_id, '${ORG}', '${PIPELINE}', '${STAGE}', 'Urgente ' || i, '${USER}')
          on conflict (id) do nothing;
          insert into public.event_log
            (id, organization_id, event_type, entity_kind, entity_id, payload, metadata)
          values (event_id, '${ORG}', 'lead.action_required', 'crm_lead', lead_id,
            '{"reason":"risk"}'::jsonb, '{}'::jsonb)
          on conflict (id) do nothing;
          perform * from public.fn_queue_lead_email_batch(event_id, '${USER}', 30);
        end loop;
      end $$;
      select count(distinct b.id) || '|' || count(i.id)
        from public.notification_email_batches b
        join public.notification_email_batch_items i on i.batch_id = b.id
       where b.organization_id = '${ORG}' and b.kind = 'urgent_lead' and b.status = 'pending';
    `);
    expect(result).toBe("1|20");

    const repeated = sql(`
      insert into public.event_log
        (id, organization_id, event_type, entity_kind, entity_id, payload, metadata)
      values ('a2590000-0000-4000-8002-000000000001', '${ORG}', 'lead.action_required', 'crm_lead',
        'a2590000-0000-4000-8000-000000000101', '{"reason":"risk"}'::jsonb, '{}'::jsonb);
      select item_inserted from public.fn_queue_lead_email_batch(
        'a2590000-0000-4000-8002-000000000001', '${USER}', 30
      );
    `);
    expect(repeated).toBe("f");

    const deferredBatchId = sql(`
      update public.notification_email_batches
         set status = 'sent', sent_at = now()
       where organization_id = '${ORG}' and kind = 'urgent_lead' and status = 'pending';
      insert into public.notification_email_batches
        (organization_id, recipient_user_id, kind, status, due_at, sent_at)
      select '${ORG}', '${USER}', 'urgent_lead', 'sent', now(), now()
        from generate_series(1, 5);
      insert into public.crm_leads
        (id, organization_id, pipeline_id, stage_id, title, owner_user_id)
      values ('a2590000-0000-4000-8000-000000000200', '${ORG}', '${PIPELINE}', '${STAGE}', 'Excedente', '${USER}');
      insert into public.event_log
        (id, organization_id, event_type, entity_kind, entity_id, payload, metadata)
      values ('a2590000-0000-4000-8002-000000000002', '${ORG}', 'lead.action_required', 'crm_lead',
        'a2590000-0000-4000-8000-000000000200', '{"reason":"risk"}'::jsonb, '{}'::jsonb);
      select batch_id from public.fn_queue_lead_email_batch(
        'a2590000-0000-4000-8002-000000000002', '${USER}', 30
      );
    `);
    expect(deferredBatchId, "a fila devolveu uma linha para o novo evento urgente").not.toBe("");

    // O batch é criado dentro da função chamada no SELECT anterior. A leitura
    // fica após o command boundary para observar o estado persistido, em vez de
    // disputar o mesmo snapshot num JOIN da própria chamada mutante.
    const deferred = sql(`
      select (due_at > date_trunc('day', now()) + interval '1 day')::text || '|' || deferred_count
        from public.notification_email_batches
       where id = '${deferredBatchId}'::uuid;
    `);
    expect(deferred).toBe("true|1");
  });
});
