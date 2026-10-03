import { nip19 } from "nostr-tools";
import { DEFAULT_RELAYS } from "../pip00";
import type { NostrFilter } from "../nostr-relays";

export function parseRelays(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [];
  const relays = values.filter((relay): relay is string => typeof relay === "string" && relay.trim().length > 0);
  return relays.length > 0 ? relays : [...DEFAULT_RELAYS];
}

export function parseLookupFilter(value: string, defaultKind: number): NostrFilter | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (!trimmed.includes(":")) {
    const pubkey = parsePubkey(trimmed);
    return pubkey ? { kinds: [defaultKind], authors: [pubkey], limit: 20 } : null;
  }

  const [kindValue, pubkeyValue, ...identifierParts] = trimmed.split(":");
  const kind = Number(kindValue);
  const identifier = identifierParts.join(":");
  const pubkey = parsePubkey(pubkeyValue);

  if (kind !== defaultKind || !pubkey || !identifier) {
    return null;
  }

  return {
    kinds: [kind],
    authors: [pubkey],
    "#d": [identifier],
    limit: 10,
  };
}

function parsePubkey(value: string): string | null {
  const trimmed = value.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return trimmed.toLowerCase();
  }

  try {
    const decoded = nip19.decode(trimmed);
    return decoded.type === "npub" && typeof decoded.data === "string" ? decoded.data : null;
  } catch {
    return null;
  }
}
