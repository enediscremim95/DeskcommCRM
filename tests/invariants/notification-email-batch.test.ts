import { beforeAll, describe, expect, it } from "vitest";

import {
  countAs,
  GOV_ADMIN,
  GOV_AGENT_A,
  GOV_LEAD,
  GOV_MANAGER,
  GOV_ORG,
  seedGov,
  sql,
} from "./gov-helpers";

const EVENT_1 = "dddddddd-1000-4000-8000-000000000001";
const EVENT_2 = "dddddddd-1000-4000-8000-000000000002";
const EVENT_3 = "dddddddd-1000-4000-8000-000000000003";

describe("lote de notificações de lead", () => {
  beforeAll(() => {
    seedGov();
    sql(`
      delete from public.event_log where id in ('${EVENT_1}', '${EVENT_2}', '${EVENT_3}');
      insert into public.event_log (
        id, organization_id, event_type, entity_kind, entity_id, payload, metadata
      ) values
        ('${EVENT_1}', '${GOV_ORG}', 'lead.created', 'crm_lead', '${GOV_LEAD}', '{}', '{}'),
        ('${EVENT_2}', '${GOV_ORG}', 'lead.created', 'crm_lead', '${GOV_LEAD}', '{}', '{}'),
        ('${EVENT_3}', '${GOV_ORG}', 'lead.created', 'crm_lead', '${GOV_LEAD}', '{}', '{}');
    `);
  });

  it("o mesmo evento e destinatário entra uma vez, mesmo reprocessado", () => {
    sql(`select * from public.fn_queue_lead_email_batch('${EVENT_1}', '${GOV_ADMIN}', 90);`);
    sql(`select * from public.fn_queue_lead_email_batch('${EVENT_1}', '${GOV_ADMIN}', 90);`);

    const count = Number(
      sql(`
        select count(*) from public.notification_email_batch_items
         where event_id = '${EVENT_1}' and recipient_user_id = '${GOV_ADMIN}';
      `),
    );
    expect(count).toBe(1);
  });

  it("rajada compartilha um lote, mas destinatários diferentes nunca se misturam", () => {
    const dueBefore = String(
      sql(`
        select due_at::text
          from public.notification_email_batches
         where organization_id = '${GOV_ORG}'
           and recipient_user_id = '${GOV_ADMIN}'
           and kind = 'new_lead'
           and status = 'pending';
      `),
    );

    sql(`select * from public.fn_queue_lead_email_batch('${EVENT_2}', '${GOV_ADMIN}', 90);`);
    sql(`select * from public.fn_queue_lead_email_batch('${EVENT_3}', '${GOV_MANAGER}', 90);`);

    const dueAfter = String(
      sql(`
        select due_at::text
          from public.notification_email_batches
         where organization_id = '${GOV_ORG}'
           and recipient_user_id = '${GOV_ADMIN}'
           and kind = 'new_lead'
           and status = 'pending';
      `),
    );

    const adminBatches = Number(
      sql(`
        select count(*) from public.notification_email_batches
         where organization_id = '${GOV_ORG}'
           and recipient_user_id = '${GOV_ADMIN}'
           and status = 'pending';
      `),
    );
    const adminItems = Number(
      sql(`
        select count(*) from public.notification_email_batch_items
         where organization_id = '${GOV_ORG}' and recipient_user_id = '${GOV_ADMIN}';
      `),
    );
    const managerItems = Number(
      sql(`
        select count(*) from public.notification_email_batch_items
         where organization_id = '${GOV_ORG}' and recipient_user_id = '${GOV_MANAGER}';
      `),
    );
    const flushes = Number(
      sql(`
        select count(*) from public.event_log
         where organization_id = '${GOV_ORG}'
           and event_type = 'notification.email_batch_due'
           and entity_id in (
             select id from public.notification_email_batches
              where recipient_user_id in ('${GOV_ADMIN}', '${GOV_MANAGER}')
           );
      `),
    );

    expect(adminBatches).toBe(1);
    expect(adminItems).toBe(2);
    expect(managerItems).toBe(1);
    expect(flushes).toBe(2);
    expect(dueAfter).toBe(dueBefore);
  });

  it("RLS deixa cada pessoa enxergar somente os próprios lotes", () => {
    expect(
      countAs(
        GOV_ADMIN,
        `select count(*) from public.notification_email_batches where organization_id = '${GOV_ORG}'`,
      ),
    ).toBe(1);
    expect(
      countAs(
        GOV_MANAGER,
        `select count(*) from public.notification_email_batches where organization_id = '${GOV_ORG}'`,
      ),
    ).toBe(1);
    expect(
      countAs(
        GOV_AGENT_A,
        `select count(*) from public.notification_email_batches where organization_id = '${GOV_ORG}'`,
      ),
    ).toBe(0);
  });
});
