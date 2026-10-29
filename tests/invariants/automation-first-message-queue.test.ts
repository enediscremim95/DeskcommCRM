import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";

import {
  GOV_CONTACT_1,
  GOV_CONV_UNASSIGNED,
  GOV_MANAGER,
  GOV_ORG,
  GOV_SESSION,
  columnExists,
  countAs,
  createTestChannel,
  seedGov,
  sql,
  tableExists,
} from "./gov-helpers";

const RULE = "cccccccc-7777-4000-8000-000000000001";
const EVENT = "cccccccc-8888-4000-8000-000000000001";
const QUEUE = "cccccccc-9999-4000-8000-000000000001";
const OUTSIDER = "cccccccc-1111-4000-8000-000000000099";

type EnqueueResult = {
  queue_id: string;
  status: string;
  next_attempt_at: string | null;
  discard_reason: string | null;
  outbound_message_id: string | null;
};

function enqueue(params: {
  organizationId: string;
  channelId: string;
  eventId: string;
  ruleId: string;
  contactId: string;
  conversationId: string;
  enqueuedAt: string;
}): EnqueueResult {
  return JSON.parse(
    sql(`
      select row_to_json(item)
      from public.fn_enqueue_automation_first_message(
        '${params.organizationId}', '${params.channelId}', '${params.eventId}',
        '${params.ruleId}', 0, '${params.contactId}', '${params.conversationId}',
        jsonb_build_object(
          'channel_session_id', '${params.channelId}',
          'template', 'Olá',
          'fila', 'primeira_mensagem'
        ),
        '${params.enqueuedAt}'::timestamptz
      ) item;
    `),
  ) as EnqueueResult;
}

describe("migrations 0293 e 0294, fila da primeira mensagem", () => {
  beforeAll(() => {
    seedGov();
    sql(`
      insert into auth.users (id, email)
        values ('${OUTSIDER}', 'queue-outsider@invariant.test') on conflict do nothing;
      insert into public.automation_rules (
        id, organization_id, name, trigger_event, conditions, actions, is_active
      ) values (
        '${RULE}', '${GOV_ORG}', 'Fila invariant', 'message.received', '[]'::jsonb,
        '[{"type":"send_whatsapp_message","config":{"channel_session_id":"${GOV_SESSION}","template":"Oi","fila":"primeira_mensagem"}}]'::jsonb,
        true
      ) on conflict (id) do nothing;
      insert into public.event_log (
        id, organization_id, event_type, entity_kind, entity_id, payload, metadata
      ) values (
        '${EVENT}', '${GOV_ORG}', 'message.received', 'message', null,
        '{"channel_session_id":"${GOV_SESSION}"}'::jsonb, '{}'::jsonb
      ) on conflict (id) do nothing;
      insert into public.automation_first_message_queue (
        id, organization_id, channel_session_id, original_event_id, rule_id,
        action_index, contact_id, conversation_id, action_config
      ) values (
        '${QUEUE}', '${GOV_ORG}', '${GOV_SESSION}', '${EVENT}', '${RULE}', 0,
        '${GOV_CONTACT_1}', '${GOV_CONV_UNASSIGNED}',
        '{"channel_session_id":"${GOV_SESSION}","template":"Oi","fila":"primeira_mensagem"}'::jsonb
      ) on conflict (id) do nothing;
    `);
  });

  it("instala a tabela e os knobs operacionais", () => {
    expect(tableExists("automation_first_message_queue")).toBe(true);
    expect(columnExists("channel_knobs", "first_message_queue_paused")).toBe(true);
    expect(columnExists("channel_knobs", "first_message_queue_daily_limit")).toBe(true);
    expect(columnExists("channel_knobs", "first_message_queue_next_at")).toBe(true);
  });

  it("isola a leitura por organização e bloqueia escrita autenticada", () => {
    expect(
      countAs(
        GOV_MANAGER,
        `select count(*) from public.automation_first_message_queue where id = '${QUEUE}';`,
      ),
    ).toBe(1);
    expect(
      countAs(
        OUTSIDER,
        `select count(*) from public.automation_first_message_queue where id = '${QUEUE}';`,
      ),
    ).toBe(0);
    expect(() =>
      sql(`
        set role authenticated;
        select set_config('request.jwt.claims', '{"sub":"${GOV_MANAGER}"}', false);
        update public.automation_first_message_queue set status = 'sent' where id = '${QUEUE}';
      `),
    ).toThrow();
  });

  it("authenticated e anon não têm privilégio de escrita na tabela nem na sequência", () => {
    const tabela = "public.automation_first_message_queue";
    for (const papel of ["authenticated", "anon"]) {
      for (const acao of ["insert", "update", "delete"]) {
        expect(sql(`select has_table_privilege('${papel}', '${tabela}', '${acao}');`).trim()).toBe("f");
      }
    }
    expect(sql(`select has_table_privilege('anon', '${tabela}', 'select');`).trim()).toBe("f");
    expect(sql(`select has_table_privilege('authenticated', '${tabela}', 'select');`).trim()).toBe("t");
    expect(sql(`select has_table_privilege('service_role', '${tabela}', 'update');`).trim()).toBe("t");
    const sequencia = sql(`select pg_get_serial_sequence('${tabela}', 'queue_sequence');`).trim();
    expect(sequencia).not.toBe("");
    for (const papel of ["authenticated", "anon"]) {
      expect(sql(`select has_sequence_privilege('${papel}', '${sequencia}', 'usage');`).trim()).toBe("f");
    }
  });

  it("recusa enqueue cruzando tenant ou canal", () => {
    const foreignChannel = randomUUID();
    expect(() =>
      sql(`select * from public.fn_enqueue_automation_first_message(
        '${GOV_ORG}', '${foreignChannel}', '${EVENT}', '${RULE}', 0,
        '${GOV_CONTACT_1}', '${GOV_CONV_UNASSIGNED}',
        '{"fila":"primeira_mensagem"}'::jsonb, now()
      );`),
    ).toThrow();
  });

  it("mantém uma única primeira mensagem viva por contato e canal", () => {
    const channelA = createTestChannel({
      organizationId: GOV_ORG,
      sessionName: `queue-contact-a-${randomUUID()}`,
    });
    const channelB = createTestChannel({
      organizationId: GOV_ORG,
      sessionName: `queue-contact-b-${randomUUID()}`,
    });
    const contactA = randomUUID();
    const contactB = randomUUID();
    const conversationA = randomUUID();
    const conversationB = randomUUID();
    const conversationAOtherChannel = randomUUID();
    const ruleId = randomUUID();
    const eventA = randomUUID();
    const duplicateEventA = randomUUID();
    const eventB = randomUUID();
    const eventAOtherChannel = randomUUID();

    sql(`
      insert into public.contacts (id, organization_id, display_name) values
        ('${contactA}', '${GOV_ORG}', 'Contato sintético A'),
        ('${contactB}', '${GOV_ORG}', 'Contato sintético B');

      insert into public.conversations (
        id, organization_id, contact_id, channel_session_id, status
      ) values
        ('${conversationA}', '${GOV_ORG}', '${contactA}', '${channelA}', 'open'),
        ('${conversationB}', '${GOV_ORG}', '${contactB}', '${channelA}', 'open'),
        ('${conversationAOtherChannel}', '${GOV_ORG}', '${contactA}', '${channelB}', 'open');

      insert into public.automation_rules (
        id, organization_id, name, trigger_event, conditions, actions, is_active
      ) values (
        '${ruleId}', '${GOV_ORG}', 'Fila sintética por contato',
        'message.received', '[]'::jsonb, '[]'::jsonb, true
      );

      insert into public.event_log (
        id, organization_id, event_type, entity_kind, entity_id, payload, metadata
      ) values
        ('${eventA}', '${GOV_ORG}', 'message.received', 'message', null, '{}'::jsonb, '{}'::jsonb),
        ('${duplicateEventA}', '${GOV_ORG}', 'message.received', 'message', null, '{}'::jsonb, '{}'::jsonb),
        ('${eventB}', '${GOV_ORG}', 'message.received', 'message', null, '{}'::jsonb, '{}'::jsonb),
        ('${eventAOtherChannel}', '${GOV_ORG}', 'message.received', 'message', null, '{}'::jsonb, '{}'::jsonb);
    `);

    const first = enqueue({
      organizationId: GOV_ORG,
      channelId: channelA,
      eventId: eventA,
      ruleId,
      contactId: contactA,
      conversationId: conversationA,
      enqueuedAt: "2026-10-29T12:00:00.000Z",
    });
    const sameOrigin = enqueue({
      organizationId: GOV_ORG,
      channelId: channelA,
      eventId: eventA,
      ruleId,
      contactId: contactA,
      conversationId: conversationA,
      enqueuedAt: "2026-10-29T12:00:00.000Z",
    });
    const duplicate = enqueue({
      organizationId: GOV_ORG,
      channelId: channelA,
      eventId: duplicateEventA,
      ruleId,
      contactId: contactA,
      conversationId: conversationA,
      enqueuedAt: "2026-10-29T12:01:00.000Z",
    });
    const otherContact = enqueue({
      organizationId: GOV_ORG,
      channelId: channelA,
      eventId: eventB,
      ruleId,
      contactId: contactB,
      conversationId: conversationB,
      enqueuedAt: "2026-10-29T12:02:00.000Z",
    });
    const otherChannel = enqueue({
      organizationId: GOV_ORG,
      channelId: channelB,
      eventId: eventAOtherChannel,
      ruleId,
      contactId: contactA,
      conversationId: conversationAOtherChannel,
      enqueuedAt: "2026-10-29T12:03:00.000Z",
    });

    expect(first.status).toBe("queued");
    expect(sameOrigin).toEqual(first);
    expect(
      Number(
        sql(`
          select count(*) from public.event_log
          where organization_id = '${GOV_ORG}'
            and event_type = 'automation.first_message_queued'
            and entity_id = '${first.queue_id}';
        `),
      ),
    ).toBe(1);

    expect(duplicate).toMatchObject({
      status: "discarded",
      discard_reason: "duplicado_do_contato",
      next_attempt_at: null,
    });
    expect(
      JSON.parse(sql(`
        select json_build_object(
          'queue_event_id', queue_event_id,
          'started_at', started_at,
          'finished', finished_at is not null,
          'live_count', (
            select count(*)
            from public.automation_first_message_queue live
            where live.id = q.id
              and live.status in ('queued', 'processing', 'sent')
          )
        )
        from public.automation_first_message_queue q
        where q.id = '${duplicate.queue_id}';
      `)),
    ).toEqual({
      queue_event_id: null,
      started_at: null,
      finished: true,
      live_count: 0,
    });
    expect(
      Number(
        sql(`
          select count(*) from public.event_log
          where organization_id = '${GOV_ORG}'
            and event_type = 'automation.first_message_queued'
            and entity_id = '${duplicate.queue_id}';
        `),
      ),
    ).toBe(0);
    expect(
      sql(`
        select decision
        from public.fn_try_claim_automation_first_message(
          '${GOV_ORG}', '${duplicate.queue_id}', now(), true
        );
      `),
    ).toBe("terminal");
    expect(
      sql(`
        select started_at is null
        from public.automation_first_message_queue
        where id = '${duplicate.queue_id}';
      `),
    ).toBe("t");

    expect(otherContact.status).toBe("queued");
    expect(otherChannel.status).toBe("queued");
  });
});
