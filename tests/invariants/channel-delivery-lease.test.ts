import { beforeAll, describe, expect, it } from 'vitest';

import {
  GOV_CONTACT_1,
  GOV_CONTACT_2,
  GOV_CONV_AGENT_B,
  GOV_CONV_UNASSIGNED,
  GOV_ORG,
  GOV_SESSION,
  seedGov,
  sql,
} from './gov-helpers';

const JOB_ATENDIMENTO = 'cccccccc-7777-4000-8000-000000000001';
const JOB_FOLLOWUP = 'cccccccc-7777-4000-8000-000000000002';

beforeAll(() => {
  seedGov();
  sql(`
    insert into public.job_queue (id, organization_id, contact_id, kind)
      values
        ('${JOB_ATENDIMENTO}', '${GOV_ORG}', '${GOV_CONTACT_1}', 'inbound_turn'),
        ('${JOB_FOLLOWUP}', '${GOV_ORG}', '${GOV_CONTACT_2}', 'followup_turn')
      on conflict (id) do nothing;
    delete from public.channel_delivery_leases where channel_session_id = '${GOV_SESSION}';
  `);
});

describe('limite compartilhado por canal', () => {
  it('bug 2, padrão 1 impede follow-up enquanto atendimento está em curso', () => {
    expect(
      sql(
        `select max_concurrent_ai_conversations from public.channel_sessions where id = '${GOV_SESSION}';`,
      ),
    ).toBe('1');

    const atendimento = sql(`
      select acquired from public.fn_try_acquire_channel_delivery_lease(
        '${GOV_ORG}', '${GOV_CONV_UNASSIGNED}', '${JOB_ATENDIMENTO}', 960
      );
    `);
    const followupOcupado = sql(`
      select acquired from public.fn_try_acquire_channel_delivery_lease(
        '${GOV_ORG}', '${GOV_CONV_AGENT_B}', '${JOB_FOLLOWUP}', 960
      );
    `);
    expect(atendimento).toBe('t');
    expect(followupOcupado).toBe('f');

    sql(`select public.fn_release_channel_delivery_lease('${GOV_ORG}', '${JOB_ATENDIMENTO}');`);
    const followupLiberado = sql(`
      select acquired from public.fn_try_acquire_channel_delivery_lease(
        '${GOV_ORG}', '${GOV_CONV_AGENT_B}', '${JOB_FOLLOWUP}', 960
      );
    `);
    expect(followupLiberado).toBe('t');
  });
});
