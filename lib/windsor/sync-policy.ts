import type { AccountRow } from "./account-fetch";

interface OrganizationSyncState {
  organization_id: string;
  last_sync_succeeded_at: string | null;
}

interface SyncFailure {
  code: string;
  message: string;
}

export function orderAccountsByOldestOrganizationSync<T extends AccountRow>(
  accounts: T[],
  states: OrganizationSyncState[],
): T[] {
  const lastSuccessByOrganization = new Map(
    states.map((state) => [state.organization_id, state.last_sync_succeeded_at] as const),
  );

  return accounts
    .map((account, index) => ({ account, index }))
    .sort((left, right) => {
      const leftAt = lastSuccessByOrganization.get(left.account.organization_id) ?? null;
      const rightAt = lastSuccessByOrganization.get(right.account.organization_id) ?? null;
      if (leftAt === null && rightAt !== null) return -1;
      if (leftAt !== null && rightAt === null) return 1;
      if (leftAt !== rightAt) return (leftAt ?? "").localeCompare(rightAt ?? "");
      return left.index - right.index;
    })
    .map(({ account }) => account);
}

export function configUpdateForSyncFailure(failure: SyncFailure): {
  sync_status: "failed";
  last_sync_error?: string;
} {
  if (failure.code === "windsor_sync_deadline") return { sync_status: "failed" };
  return { sync_status: "failed", last_sync_error: failure.message };
}
