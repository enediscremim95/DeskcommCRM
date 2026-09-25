import type { Queryable } from '../../queue/queue';

// O maior turno medido no fluxo legado levou 12,4 minutos. Dezesseis minutos
// preservam margem para um turno legítimo e ainda recuperam crash sem intervenção.
export const CHANNEL_DELIVERY_LEASE_TTL_SECONDS = 16 * 60;

export type ChannelDeliveryLeaseResult =
  | { acquired: true }
  | { acquired: false; retryAfterMs: number };

export async function acquireChannelDeliveryLease(
  db: Queryable,
  input: { tenantId: string; conversationId: string; jobId: string },
): Promise<ChannelDeliveryLeaseResult> {
  const { rows } = await db.query<{ acquired: boolean; retry_after_ms: number }>(
    `select acquired, retry_after_ms
       from public.fn_try_acquire_channel_delivery_lease($1, $2, $3, $4)`,
    [input.tenantId, input.conversationId, input.jobId, CHANNEL_DELIVERY_LEASE_TTL_SECONDS],
  );
  const result = rows[0];
  if (!result) throw new Error('channel_delivery_lease_without_result');
  return result.acquired
    ? { acquired: true }
    : { acquired: false, retryAfterMs: Math.max(1_000, result.retry_after_ms) };
}

export async function releaseChannelDeliveryLease(
  db: Queryable,
  input: { tenantId: string; jobId: string },
): Promise<void> {
  await db.query('select public.fn_release_channel_delivery_lease($1, $2)', [
    input.tenantId,
    input.jobId,
  ]);
}
