import { beforeAll, describe, expect, it } from "vitest";

import {
  GOV_AGENT_A,
  GOV_AGENT_B,
  GOV_CONTACT_1,
  GOV_CONV_UNASSIGNED,
  GOV_ORG,
  GOV_SESSION,
  countAs,
  seedGov,
  sql,
  writeCountAs,
} from "./gov-helpers";

const MESSAGE_ID = "abbbbbbb-7777-4777-8777-777777777777";
const OUTRA_ORG = "abbbbbbb-0000-4000-8000-000000000001";

beforeAll(() => {
  seedGov();
  sql(`
    insert into public.organizations (id, slug, legal_name, display_name)
      values ('${OUTRA_ORG}', 'inbox-personal-state-rls', 'Inbox RLS', 'Inbox RLS')
      on conflict do nothing;
    insert into public.messages
      (id, organization_id, conversation_id, channel_session_id, contact_id, type, direction, body)
      values ('${MESSAGE_ID}', '${GOV_ORG}', '${GOV_CONV_UNASSIGNED}', '${GOV_SESSION}', '${GOV_CONTACT_1}', 'text', 'inbound', 'rls probe')
      on conflict (id) do nothing;
  `);
});

describe("RLS das preferências pessoais do Inbox", () => {
  it("isola conversa por usuário mesmo dentro da mesma organização", () => {
    expect(writeCountAs(
      GOV_AGENT_A,
      `insert into public.inbox_user_conversation_state
       (organization_id, user_id, conversation_id, favorited_at)
       values ('${GOV_ORG}', '${GOV_AGENT_A}', '${GOV_CONV_UNASSIGNED}', now())
       on conflict (organization_id, user_id, conversation_id) do update set favorited_at = excluded.favorited_at`,
    )).toBe(1);
    expect(countAs(
      GOV_AGENT_B,
      `select count(*) from public.inbox_user_conversation_state
       where organization_id = '${GOV_ORG}' and user_id = '${GOV_AGENT_A}'`,
    )).toBe(0);
    expect(writeCountAs(
      GOV_AGENT_B,
      `insert into public.inbox_user_conversation_state
       (organization_id, user_id, conversation_id, favorited_at)
       values ('${GOV_ORG}', '${GOV_AGENT_A}', '${GOV_CONV_UNASSIGNED}', now())`,
    )).toBe(0);
  });

  it("bloqueia organização sem vínculo e permite a própria linha", () => {
    expect(writeCountAs(
      GOV_AGENT_A,
      `insert into public.inbox_user_conversation_state
       (organization_id, user_id, conversation_id, pinned_at)
       values ('${OUTRA_ORG}', '${GOV_AGENT_A}', '${GOV_CONV_UNASSIGNED}', now())`,
    )).toBe(0);
    expect(countAs(
      GOV_AGENT_A,
      `select count(*) from public.inbox_user_conversation_state
       where organization_id = '${GOV_ORG}' and user_id = '${GOV_AGENT_A}'`,
    )).toBe(1);
  });

  it("isola estrelas de mensagem por usuário", () => {
    expect(writeCountAs(
      GOV_AGENT_A,
      `insert into public.inbox_user_message_state
       (organization_id, user_id, message_id, starred_at)
       values ('${GOV_ORG}', '${GOV_AGENT_A}', '${MESSAGE_ID}', now())
       on conflict (organization_id, user_id, message_id) do update set starred_at = excluded.starred_at`,
    )).toBe(1);
    expect(countAs(
      GOV_AGENT_B,
      `select count(*) from public.inbox_user_message_state
       where organization_id = '${GOV_ORG}' and user_id = '${GOV_AGENT_A}'`,
    )).toBe(0);
  });
});
