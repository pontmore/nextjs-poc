import { verifyEvent } from "nostr-tools";
import type { NostrEvent } from "./pip00";

export type RelayResult = {
  relay: string;
  ok: boolean;
  message: string;
};

export type NostrFilter = {
  kinds?: number[];
  authors?: string[];
  "#d"?: string[];
  "#t"?: string[];
  limit?: number;
  since?: number;
};

const REQUEST_TIMEOUT_MS = 8000;
const PUBLISH_TIMEOUT_MS = 8000;

export async function publishToRelays(
  relays: string[],
  event: NostrEvent,
): Promise<RelayResult[]> {
  return Promise.all(relays.map((relay) => publishToRelay(relay, event)));
}

export async function fetchFromRelays(
  relays: string[],
  filter: NostrFilter,
): Promise<{ events: NostrEvent[]; results: RelayResult[] }> {
  const settled = await Promise.all(relays.map((relay) => fetchFromRelay(relay, filter)));
  const eventsById = new Map<string, NostrEvent>();
  const results: RelayResult[] = [];

  for (const result of settled) {
    results.push({ relay: result.relay, ok: result.ok, message: result.message });
    for (const event of result.events) {
      eventsById.set(event.id, event);
    }
  }

  return {
    events: [...eventsById.values()].sort((a, b) => b.created_at - a.created_at),
    results,
  };
}

function publishToRelay(relay: string, event: NostrEvent): Promise<RelayResult> {
  return new Promise((resolve) => {
    const ws = new WebSocket(relay);
    const timeout = globalThis.setTimeout(() => {
      ws.close();
      resolve({ relay, ok: false, message: "Timed out waiting for relay OK." });
    }, PUBLISH_TIMEOUT_MS);

    ws.onopen = () => {
      ws.send(JSON.stringify(["EVENT", event]));
    };

    ws.onmessage = (message) => {
      const data = parseRelayMessage(message.data);
      if (!data || data[0] !== "OK" || data[1] !== event.id) {
        return;
      }

      globalThis.clearTimeout(timeout);
      ws.close();
      resolve({
        relay,
        ok: Boolean(data[2]),
        message: typeof data[3] === "string" ? data[3] : data[2] ? "Accepted." : "Rejected.",
      });
    };

    ws.onerror = () => {
      globalThis.clearTimeout(timeout);
      ws.close();
      resolve({ relay, ok: false, message: "WebSocket error." });
    };
  });
}

function fetchFromRelay(
  relay: string,
  filter: NostrFilter,
): Promise<{ relay: string; ok: boolean; message: string; events: NostrEvent[] }> {
  return new Promise((resolve) => {
    const ws = new WebSocket(relay);
    const subscriptionId = `pip00-${crypto.randomUUID()}`;
    const events: NostrEvent[] = [];
    const timeout = globalThis.setTimeout(() => {
      ws.close();
      resolve({ relay, ok: events.length > 0, message: "Timed out after partial read.", events });
    }, REQUEST_TIMEOUT_MS);

    ws.onopen = () => {
      ws.send(JSON.stringify(["REQ", subscriptionId, filter]));
    };

    ws.onmessage = (message) => {
      const data = parseRelayMessage(message.data);
      if (!data) {
        return;
      }

      if (data[0] === "EVENT" && data[1] === subscriptionId && isNostrEvent(data[2]) && matchesNostrFilter(data[2], filter)) {
        events.push(data[2]);
      }

      if (data[0] === "EOSE" && data[1] === subscriptionId) {
        globalThis.clearTimeout(timeout);
        ws.send(JSON.stringify(["CLOSE", subscriptionId]));
        ws.close();
        resolve({ relay, ok: true, message: `Read ${events.length} event(s).`, events });
      }
    };

    ws.onerror = () => {
      globalThis.clearTimeout(timeout);
      ws.close();
      resolve({ relay, ok: false, message: "WebSocket error.", events });
    };
  });
}

function parseRelayMessage(data: unknown): unknown[] | null {
  if (typeof data !== "string") {
    return null;
  }

  try {
    const parsed = JSON.parse(data);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function isNostrEvent(value: unknown): value is NostrEvent {
  if (!value || typeof value !== "object") {
    return false;
  }

  const event = value as Partial<NostrEvent>;
  const validShape = (
    typeof event.id === "string" &&
    typeof event.pubkey === "string" &&
    typeof event.created_at === "number" &&
    typeof event.kind === "number" &&
    Number.isSafeInteger(event.created_at) && event.created_at! >= 0 &&
    Number.isSafeInteger(event.kind) &&
    Array.isArray(event.tags) && event.tags.every((tag) => Array.isArray(tag) && tag.every((item) => typeof item === "string")) &&
    typeof event.content === "string" &&
    typeof event.sig === "string"
  );
  if (!validShape) return false;
  try {
    // Verify a plain wire event; never trust nostr-tools verification caches on callers.
    return verifyEvent({ id: event.id!, pubkey: event.pubkey!, created_at: event.created_at!,
      kind: event.kind!, tags: event.tags!, content: event.content!, sig: event.sig! });
  } catch { return false; }
}

export function matchesNostrFilter(event: NostrEvent, filter: NostrFilter): boolean {
  return (!filter.kinds || filter.kinds.includes(event.kind)) &&
    (!filter.authors || filter.authors.includes(event.pubkey)) &&
    (filter.since === undefined || event.created_at >= filter.since) &&
    (["#d", "#t"] as const).every((key) => !filter[key] || event.tags.some((tag) => tag[0] === key.slice(1) && filter[key]!.includes(tag[1])));
}
