import type { NostrFilter } from "../nostr-relays";
import { PIP01_ESCROW_KIND } from "../pip01";
import { createAddressableEventCache, type RefreshSnapshot } from "./addressable-cache";

const escrowCache = createAddressableEventCache({
  kinds: [PIP01_ESCROW_KIND],
  limit: 100,
});

export type { RefreshSnapshot };

export function getEscrowSnapshot(relays: string[]): RefreshSnapshot {
  return escrowCache.getSnapshot(relays);
}

export function refreshEscrows(relays: string[], filter?: NostrFilter): Promise<RefreshSnapshot> {
  return escrowCache.refresh(relays, filter);
}
