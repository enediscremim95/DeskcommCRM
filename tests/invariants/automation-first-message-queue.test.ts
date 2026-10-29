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
  seedGov,
  sql,
  tableExists,
} from "./gov-helpers";

const RULE = "cccccccc-7777-4000-8000-000000000001";
const EVENT = "cccccccc-8888-4000-8000-000000000001";
const QUEUE = "cccccccc-9999-4000-8000-000000000001";
const OUTSIDER = "cccccccc-1111-4000-8000-000000000099";

describe("migration 0293, fila da primeira mensagem", () => {
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
});
