import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import type { EventRow } from '@/lib/event-log/dispatcher';
import type { EnrollmentPatch } from '@/lib/followup/engine';
import {
  applyReactivityEvent,
  type LiveEnrollmentRef,
  type ReactivityAdminClient,
} from '@/lib/followup/reactivity';

const agora = () => new Date('2026-09-25T12:00:00.000Z');

function evento(
  eventType: 'message.received' | 'message.sent',
  metadata: Record<string, unknown> = {},
): EventRow {
  return {
    id: `evento-${eventType}`,
    organization_id: '11111111-1111-4111-8111-111111111111',
    event_type: eventType,
    entity_kind: 'message',
    entity_id: null,
    payload:
      eventType === 'message.received'
        ? { contact_id: '22222222-2222-4222-8222-222222222222' }
        : { conversation_id: '33333333-3333-4333-8333-333333333333' },
    metadata,
    consumed_by: [],
    attempts: 0,
  };
}

function bancoReativo(
  opts: { scheduled?: number; live?: LiveEnrollmentRef[]; sentVia?: string | null } = {},
) {
  const patches: EnrollmentPatch[] = [];
  const cancelPendingScheduledFollowups = vi.fn().mockResolvedValue(opts.scheduled ?? 1);
  const db: ReactivityAdminClient = {
    async loadConversationContactId() {
      return '22222222-2222-4222-8222-222222222222';
    },
    async loadMessageSentVia() {
      return opts.sentVia ?? null;
    },
    async loadContactBlocked() {
      return false;
    },
    async loadLiveEnrollmentsForContact() {
      return opts.live ?? [];
    },
    cancelPendingScheduledFollowups,
    async insertEnrollmentEvent() {
      return { inserted: true };
    },
    async updateEnrollment(_id, _org, patch) {
      patches.push(patch);
    },
    async agoraNoBanco() {
      return agora().toISOString();
    },
  };
  return { db, patches, cancelPendingScheduledFollowups };
}

describe('bugs pagos pelo fluxo anterior', () => {
  it('bug 4, resposta do contato remove follow-up agendado', async () => {
    const { db, cancelPendingScheduledFollowups } = bancoReativo();
    await applyReactivityEvent(db, agora, evento('message.received'));
    expect(cancelPendingScheduledFollowups).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    );
  });

  it('bug 4, resposta humana remove a agenda e encerra o follow-up vivo', async () => {
    const live: LiveEnrollmentRef = {
      id: '44444444-4444-4444-8444-444444444444',
      status: 'active',
      current_node_id: 'espera',
      steps_taken: 1,
      pointer_id: '55555555-5555-4555-8555-555555555555',
      handoff_policy: 'pause',
      trigger_config: null,
    };
    const { db, patches, cancelPendingScheduledFollowups } = bancoReativo({ live: [live] });
    const result = await applyReactivityEvent(
      db,
      agora,
      evento('message.sent', { actor_type: 'user' }),
    );
    expect(cancelPendingScheduledFollowups).toHaveBeenCalledOnce();
    expect(patches).toContainEqual(
      expect.objectContaining({ status: 'cancelled', cancel_reason: 'human_replied' }),
    );
    expect(result).toEqual({ matched: true, reacted: 2 });
  });

  it('bug 4, fala digitada no próprio WhatsApp também remove o follow-up', async () => {
    const { db, cancelPendingScheduledFollowups } = bancoReativo({
      sentVia: 'external_device',
    });
    const humanMessage = evento('message.sent');
    humanMessage.entity_id = '66666666-6666-4666-8666-666666666666';
    const result = await applyReactivityEvent(db, agora, humanMessage);
    expect(cancelPendingScheduledFollowups).toHaveBeenCalledOnce();
    expect(result).toEqual({ matched: true, reacted: 1 });
  });

  it('bug 4, resposta do próprio agente não cancela o follow-up', async () => {
    const { db, cancelPendingScheduledFollowups } = bancoReativo();
    const result = await applyReactivityEvent(
      db,
      agora,
      evento('message.sent', { actor_type: 'ai_agent' }),
    );
    expect(cancelPendingScheduledFollowups).not.toHaveBeenCalled();
    expect(result).toEqual({ matched: false, reacted: 0 });
  });

  it('bug 5, esperar a vez é lease persistida e reagendamento, nunca pg_sleep', () => {
    const migration = readFileSync(
      join(
        process.cwd(),
        'supabase/migrations/20260925140000_0263_limite_conversas_por_canal.sql',
      ),
      'utf8',
    );
    const send = readFileSync(
      join(process.cwd(), 'lib/agent-engine/edge/crm/send-message.ts'),
      'utf8',
    );
    const baseline = readFileSync(join(process.cwd(), 'supabase/baseline.sql'), 'utf8');
    expect(migration.toLowerCase()).not.toContain('pg_sleep');
    expect(migration).toContain('channel_delivery_leases');
    expect(migration).toContain('expires_at');
    expect(migration).toContain(
      'organization_id in (select public.fn_user_org_ids())',
    );
    expect(baseline).toContain(
      'add column if not exists max_concurrent_ai_conversations',
    );
    expect(baseline).toContain(
      'create table if not exists public.channel_delivery_leases',
    );
    expect(baseline).toContain(
      'create or replace function public.fn_try_acquire_channel_delivery_lease',
    );
    expect(baseline).toContain(
      'organization_id in (select public.fn_user_org_ids())',
    );
    expect(send).toContain("case 'deferred'");
    expect(send).toContain('rescheduleJob');
  });
});
