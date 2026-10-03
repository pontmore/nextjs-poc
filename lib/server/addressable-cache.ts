import { fetchFromRelays, type NostrFilter, type RelayResult } from "../nostr-relays";
import type { NostrEvent } from "../pip00";

type CacheEntry = {
  events: Map<string, NostrEvent>;
  results: RelayResult[];
  lastRefreshAt: string | null;
  fullRefreshPromise: Promise<RefreshSnapshot> | null;
};

export type RefreshSnapshot = {
  events: NostrEvent[];
  results: RelayResult[];
  lastRefreshAt: string | null;
  refreshing: boolean;
};

const BACKGROUND_REFRESH_INTERVAL_MS = 30_000;

export function createAddressableEventCache(defaultFilter: NostrFilter) {
  const cacheByRelayKey = new Map<string, CacheEntry>();

  function getSnapshot(relays: string[]): RefreshSnapshot {
    const entry = getCacheEntry(relays);
    if (shouldRefresh(entry)) {
      void refresh(relays);
    }
    return snapshot(entry);
  }

  async function refresh(relays: string[], filter?: NostrFilter): Promise<RefreshSnapshot> {
    const entry = getCacheEntry(relays);
    if (!filter && entry.fullRefreshPromise) {
      return entry.fullRefreshPromise;
    }

    const refreshPromise = runRefresh(entry, relays, filter);
    if (!filter) {
      entry.fullRefreshPromise = refreshPromise.finally(() => {
        entry.fullRefreshPromise = null;
      });
      return entry.fullRefreshPromise;
    }

    return refreshPromise;
  }

  function getCacheEntry(relays: string[]): CacheEntry {
    const key = relayKey(relays);
    const existing = cacheByRelayKey.get(key);
    if (existing) {
      return existing;
    }

    const created: CacheEntry = {
      events: new Map(),
      results: [],
      lastRefreshAt: null,
      fullRefreshPromise: null,
    };
    cacheByRelayKey.set(key, created);
    return created;
  }

  async function runRefresh(entry: CacheEntry, relays: string[], filter?: NostrFilter): Promise<RefreshSnapshot> {
    const result = await fetchFromRelays(relays, filter ?? defaultFilter);

    for (const event of result.events) {
      storeLatestAddressableEvent(entry.events, event);
    }

    entry.results = result.results;
    entry.lastRefreshAt = new Date().toISOString();
    return snapshot(entry);
  }

  function snapshot(entry: CacheEntry): RefreshSnapshot {
    return {
      events: [...entry.events.values()].sort((a, b) => b.created_at - a.created_at),
      results: entry.results,
      lastRefreshAt: entry.lastRefreshAt,
      refreshing: Boolean(entry.fullRefreshPromise),
    };
  }

  return { getSnapshot, refresh };
}

function relayKey(relays: string[]): string {
  return [...new Set(relays)].sort().join("\n");
}

function storeLatestAddressableEvent(events: Map<string, NostrEvent>, event: NostrEvent) {
  const key = addressableKey(event);
  const existing = events.get(key);
  if (!existing || event.created_at > existing.created_at || (event.created_at === existing.created_at && event.id < existing.id)) {
    events.set(key, event);
  }
}

function addressableKey(event: NostrEvent): string {
  return `${event.kind}:${event.pubkey}:${findTagValue(event.tags, "d") || event.id}`;
}

function findTagValue(tags: string[][], name: string): string | undefined {
  return tags.find((tag) => tag[0] === name)?.[1];
}

function shouldRefresh(entry: CacheEntry): boolean {
  if (entry.fullRefreshPromise) {
    return false;
  }

  if (!entry.lastRefreshAt) {
    return true;
  }

  return Date.now() - Date.parse(entry.lastRefreshAt) > BACKGROUND_REFRESH_INTERVAL_MS;
}
