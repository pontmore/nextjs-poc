import { nip19 } from "nostr-tools";
import { CAPABILITY_PATTERN, type NostrEvent } from "./pip00";
import { isNostrEvent } from "./nostr-relays";
import { observePublicKernelAction } from "./public-kernel-observation";

export const SWAP_PROFILE = "pontmore/swap@1";
const hex = /^[0-9a-f]{64}$/;
const profileId = CAPABILITY_PATTERN;
export function isCoordinationProfile(value: unknown): value is string {
  return typeof value === "string" && profileId.test(value);
}
export function parseCoordinationProfilePath(parts: unknown): string | null {
  if (!Array.isArray(parts) || parts.some((part) => typeof part !== "string"))
    return null;
  try {
    const profile = parts.map((part) => decodeURIComponent(part)).join("/");
    return isCoordinationProfile(profile) ? profile : null;
  } catch {
    return null;
  }
}
export function coordinationProfiles(
  items: Pick<Coordination, "profile">[],
): string[] {
  return [
    ...new Set(items.map((c) => c.profile).filter(isCoordinationProfile)),
  ].sort();
}
export function normalizeCoordinationProfile(profile: string): string {
  if (!isCoordinationProfile(profile))
    throw new Error("Invalid pinned coordination profile ID.");
  return profile.replace("/", "-").replace("@", "-");
}
export function isCoordinationProfileSlug(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[a-z0-9][a-z0-9._-]*-[a-z0-9][a-z0-9._-]*-[1-9][0-9]*$/.test(value)
  );
}
export function coordinationProfileHref(
  profile: string,
  profiles: string[] = [],
): string {
  const slug = normalizeCoordinationProfile(profile);
  const ambiguous = profiles.some(
    (other) =>
      other !== profile && normalizeCoordinationProfile(other) === slug,
  );
  return `/coordinations/profiles/${slug}${ambiguous ? `?profile=${encodeURIComponent(profile)}` : ""}`;
}
type ObjectValue = Record<string, unknown>;
export type SwapTerms = {
  direction: "fiat_to_btc" | "btc_to_fiat";
  fiat: { currency: string; amount: string };
  bitcoin: { amount: string; unit: "sat"; network: string };
  payment_channel: string;
  deadlines: { fiat_pay_by: number; fiat_confirm_by: number };
};
export type PublicAction = {
  event: NostrEvent;
  action: string;
  prev: string;
  data: ObjectValue;
};
export type Coordination = {
  root: NostrEvent;
  profile: string;
  terms: ObjectValue;
  expiresAt: number;
  roles: Record<string, string>;
  swap: SwapTerms | null;
  actions: PublicAction[];
  linkedEvents: NostrEvent[];
  history: PublicAction[];
  state: string;
  issues: string[];
};
function object(value: unknown): value is ObjectValue {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function json(event: NostrEvent): ObjectValue | null {
  try {
    const value = JSON.parse(event.content);
    return object(value) ? value : null;
  } catch {
    return null;
  }
}
function timestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function marked(
  event: NostrEvent,
  type: string,
  marker: string,
): string | null {
  const tags = event.tags.filter((t) => t[0] === type && t[3] === marker);
  return tags.length === 1 ? tags[0][1] : null;
}
export function parseRootId(value: string): string | null {
  const input = value.trim().replace(/^nostr:/, "");
  if (hex.test(input.toLowerCase())) return input.toLowerCase();
  try {
    const decoded = nip19.decode(input);
    if (decoded.type === "note") return decoded.data;
    if (decoded.type === "nevent") return decoded.data.id;
  } catch {
    /* invalid identifier */
  }
  return null;
}
function swapTerms(terms: ObjectValue, expiresAt: number): SwapTerms | null {
  const { fiat, bitcoin, deadlines } = terms;
  if (!object(fiat) || !object(bitcoin) || !object(deadlines)) return null;
  if (
    !["fiat_to_btc", "btc_to_fiat"].includes(String(terms.direction)) ||
    typeof fiat.currency !== "string" ||
    !/^[A-Z]{3}$/.test(fiat.currency) ||
    typeof fiat.amount !== "string" ||
    !/^\d+(\.\d+)?$/.test(fiat.amount) ||
    !/[1-9]/.test(fiat.amount) ||
    fiat.amount.length > 100 ||
    typeof bitcoin.amount !== "string" ||
    !/^\d+$/.test(bitcoin.amount) ||
    !/[1-9]/.test(bitcoin.amount) ||
    bitcoin.amount.length > 100 ||
    bitcoin.unit !== "sat" ||
    typeof bitcoin.network !== "string" ||
    !bitcoin.network ||
    typeof terms.payment_channel !== "string" ||
    !/@[1-9]\d*$/.test(terms.payment_channel) ||
    !timestamp(deadlines.fiat_pay_by) ||
    !timestamp(deadlines.fiat_confirm_by) ||
    !(
      expiresAt < deadlines.fiat_pay_by &&
      deadlines.fiat_pay_by < deadlines.fiat_confirm_by
    )
  )
    return null;
  return terms as SwapTerms;
}
export function reconstructCoordination(
  root: NostrEvent,
  events: NostrEvent[],
): Coordination | null {
  if (!isNostrEvent(root) || root.kind !== 7300) return null;
  const content = json(root);
  if (
    !content ||
    content.version !== 2 ||
    typeof content.profile !== "string" ||
    !profileId.test(content.profile) ||
    !object(content.terms) ||
    !timestamp(content.expires_at)
  )
    return null;
  const roles: Record<string, string> = {};
  const issues: string[] = [];
  if (
    Object.keys(content).some(
      (key) =>
        !["version", "profile", "terms", "expires_at", "commitments"].includes(
          key,
        ),
    )
  )
    issues.push("Unexpected root content fields.");
  for (const tag of root.tags.filter((t) => t[0] === "p")) {
    if (!hex.test(tag[1]) || !tag[3] || roles[tag[3]])
      issues.push("Invalid or duplicate participant role.");
    else roles[tag[3]] = tag[1];
  }
  if (!roles["core/escrow"]) issues.push("Missing escrow authority.");
  if (
    !hex.test(marked(root, "e", "escrow-version") || "") ||
    !/^30361:[0-9a-f]{64}:.+$/.test(marked(root, "a", "escrow") || "")
  )
    issues.push("Missing or invalid escrow descriptor references.");
  const swap =
    content.profile === SWAP_PROFILE
      ? swapTerms(content.terms, content.expires_at)
      : null;
  if (
    content.profile === SWAP_PROFILE &&
    (!swap ||
      !roles["swap/agent"] ||
      !roles["swap/customer"] ||
      roles["swap/agent"] === roles["swap/customer"] ||
      ![roles["swap/agent"], roles["swap/customer"]].includes(root.pubkey))
  )
    issues.push("Invalid swap terms or participant binding.");
  if (
    content.commitments !== undefined &&
    (!object(content.commitments) ||
      Object.entries(content.commitments).some(
        ([key, value]) =>
          !object(value) ||
          value.algorithm !== "sha256-bytes@1" ||
          typeof value.digest !== "string" ||
          !/^sha256:[0-9a-f]{64}$/.test(value.digest) ||
          (swap && !["quote", "private_terms"].includes(key)),
      ))
  )
    issues.push("Unsupported or invalid commitments.");
  const actions: PublicAction[] = [],
    linkedEvents: NostrEvent[] = [];
  for (const event of new Map(events.map((e) => [e.id, e])).values()) {
    if (
      event.kind !== 7301 ||
      !Array.isArray(event.tags) ||
      !event.tags.some(
        (t) =>
          Array.isArray(t) &&
          t[0] === "e" &&
          t[3] === "root" &&
          t[1] === root.id,
      ) ||
      !isNostrEvent(event)
    )
      continue;
    linkedEvents.push(event);
    const c = json(event),
      prev = marked(event, "e", "prev");
    if (
      !c ||
      c.version !== 2 ||
      typeof c.action !== "string" ||
      !prev ||
      !hex.test(prev) ||
      marked(event, "e", "root") !== root.id ||
      (c.data !== undefined && !object(c.data)) ||
      Object.keys(c).some((k) => !["version", "action", "data"].includes(k))
    ) {
      issues.push("Malformed linked action.");
      continue;
    }
    actions.push({
      event,
      action: c.action,
      prev,
      data: object(c.data) ? c.data : {},
    });
  }
  let tip = root.id,
    state = "proposed",
    beforeDispute = state;
  const history: PublicAction[] = [],
    seen = new Set<string>();
  let reference: unknown;
  while (true) {
    const children = actions.filter(
      (a) => a.prev === tip && !seen.has(a.event.id),
    );
    if (!children.length) break;
    if (children.length > 1) {
      issues.push("Fork detected; no branch selected.");
      state = "forked";
      break;
    }
    const next = children[0];
    seen.add(next.event.id);
    if (swap) {
      const participant = [
        roles["swap/agent"],
        roles["swap/customer"],
      ].includes(next.event.pubkey);
      const receiver =
        roles[
          swap.direction === "fiat_to_btc" ? "swap/agent" : "swap/customer"
        ];
      const sender =
        roles[
          swap.direction === "fiat_to_btc" ? "swap/customer" : "swap/agent"
        ];
      const other = next.event.pubkey !== root.pubkey && participant;
      const at = next.event.created_at;
      const escrow = next.event.pubkey === roles["core/escrow"];
      let valid = false,
        target = state;
      switch (next.action) {
        case "core/accept":
          valid = other && state === "proposed" && at < content.expires_at;
          target = "accepted";
          break;
        case "core/decline":
          valid = other && state === "proposed";
          target = "declined";
          break;
        case "core/cancel":
          valid =
            (state === "proposed" && next.event.pubkey === root.pubkey) ||
            (state === "accepted" && participant);
          target = "cancelled";
          break;
        case "core/expire":
          valid =
            participant && state === "proposed" && at >= content.expires_at;
          target = "expired";
          break;
        case "core/secure":
          valid = escrow && state === "accepted";
          target = "secured";
          break;
        case "swap/fiat_sent":
          valid =
            next.event.pubkey === sender &&
            state === "secured" &&
            at < swap.deadlines.fiat_pay_by &&
            safeReference(next.data.payment_reference);
          reference = next.data.payment_reference;
          target = "fiat_sent";
          break;
        case "swap/fiat_confirmed":
          valid =
            next.event.pubkey === receiver &&
            state === "fiat_sent" &&
            at < swap.deadlines.fiat_confirm_by &&
            safeReference(next.data.payment_reference) &&
            sameReference(reference, next.data.payment_reference);
          target = "fiat_confirmed";
          break;
        case "core/authorize_settlement":
          valid = next.event.pubkey === receiver && state === "fiat_confirmed";
          target = "settlement_authorized";
          break;
        case "core/settle":
          valid =
            escrow &&
            state === "settlement_authorized" &&
            history.some((a) => a.action === "core/secure");
          target = "settled";
          break;
        case "core/authorize_refund":
          valid =
            next.event.pubkey === receiver &&
            state === "secured" &&
            at >= swap.deadlines.fiat_pay_by;
          target = "refund_authorized";
          break;
        case "core/refund":
          valid = escrow && state === "refund_authorized";
          target = "refunded";
          break;
        case "core/open_dispute":
          valid =
            participant &&
            ![
              "proposed",
              "disputed",
              "settled",
              "refunded",
              "declined",
              "cancelled",
              "expired",
            ].includes(state);
          beforeDispute = state;
          target = "disputed";
          break;
        case "core/resolve_dispute":
          valid =
            next.event.pubkey === roles["core/resolver"] &&
            state === "disputed" &&
            typeof next.data.policy === "string" &&
            !!next.data.policy &&
            [
              "resume",
              "authorize_settlement",
              "authorize_refund",
              "cancel",
            ].includes(String(next.data.effect)) &&
            (next.data.effect !== "authorize_settlement" ||
              history.some((a) => a.action === "core/secure"));
          target =
            (
              {
                resume: beforeDispute,
                authorize_settlement: "settlement_authorized",
                authorize_refund: "refund_authorized",
                cancel: "cancelled",
              } as Record<string, string>
            )[String(next.data.effect)] || state;
          break;
      }
      const allowed = next.action.startsWith("swap/")
        ? ["payment_reference", "evidence"]
        : next.action === "core/open_dispute"
          ? ["class", "evidence"]
          : next.action === "core/resolve_dispute"
            ? ["policy", "effect", "evidence"]
            : ["evidence"];
      const evidenceValid =
        next.data.evidence === undefined ||
        (Array.isArray(next.data.evidence) &&
          next.data.evidence.every(
            (e) =>
              object(e) &&
              ["event", "commitment", "opaque"].includes(String(e.type)) &&
              typeof e.value === "string" &&
              !!e.value &&
              (e.type !== "event" || hex.test(e.value)) &&
              (e.type !== "commitment" ||
                /^sha256:[0-9a-f]{64}$/.test(e.value)),
          ));
      const classValid =
        next.action !== "core/open_dispute" ||
        next.data.class === undefined ||
        [
          "fiat_not_received",
          "incorrect_fiat_amount",
          "payment_reference_invalid",
          "escrow_not_secured",
          "bitcoin_not_released",
          "conflicting_confirmation",
          "timeout",
        ].includes(String(next.data.class));
      if (
        !valid ||
        !evidenceValid ||
        !classValid ||
        at < root.created_at ||
        Object.keys(next.data).some((k) => !allowed.includes(k))
      ) {
        issues.push(`Invalid action or authority: ${next.action}.`);
        state = "invalid";
        break;
      }
      state = target;
    } else {
      if (next.action === "core/open_dispute") beforeDispute = state;
      const observed = observePublicKernelAction(
        root,
        roles,
        content.expires_at,
        state,
        beforeDispute,
        next,
        history,
      );
      if (!observed) {
        issues.push(`Invalid public kernel claim or signer: ${next.action}.`);
        state = "invalid";
        break;
      }
      state = observed;
    }
    history.push(next);
    tip = next.event.id;
  }
  if (actions.some((a) => !seen.has(a.event.id)))
    issues.push("Unresolved actions: missing predecessors or fork branches.");
  if (issues.length && !["forked", "invalid"].includes(state))
    state = "incomplete";
  return {
    root,
    profile: content.profile,
    terms: content.terms,
    expiresAt: content.expires_at,
    roles,
    swap,
    actions,
    linkedEvents,
    history,
    state,
    issues: [...new Set(issues)],
  };
}
function safeReference(value: unknown): boolean {
  return (
    (typeof value === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(value)) ||
    (object(value) &&
      Object.keys(value).every((key) =>
        ["algorithm", "digest"].includes(key),
      ) &&
      value.algorithm === "sha256-bytes@1" &&
      typeof value.digest === "string" &&
      /^sha256:[0-9a-f]{64}$/.test(value.digest))
  );
}
function sameReference(a: unknown, b: unknown): boolean {
  return typeof a === "string"
    ? a === b
    : object(a) &&
        object(b) &&
        a.algorithm === b.algorithm &&
        a.digest === b.digest;
}
export function addDecimal(a: string, b: string): string {
  const [ai, af = ""] = a.split("."),
    [bi, bf = ""] = b.split(".");
  const scale = Math.max(af.length, bf.length);
  const sum = (
    BigInt(ai + af.padEnd(scale, "0")) + BigInt(bi + bf.padEnd(scale, "0"))
  )
    .toString()
    .padStart(scale + 1, "0");
  return scale
    ? `${sum.slice(0, -scale)}.${sum.slice(-scale)}`.replace(/\.?0+$/, "")
    : sum;
}
export function swapMetrics(items: Coordination[]) {
  const swaps = [
    ...new Map(
      items
        .filter((c) => c.profile === SWAP_PROFILE)
        .map((c) => [c.root.id, c]),
    ).values(),
  ];
  const settled = swaps.filter(
    (c) => c.swap && c.state === "settled" && !c.issues.length,
  );
  const volumes: Record<string, { proposed: string; settled: string }> = {};
  for (const c of swaps.filter((c) => c.swap && !c.issues.length)) {
    const t = c.swap!;
    const v = (volumes[t.fiat.currency] ||= { proposed: "0", settled: "0" });
    v.proposed = addDecimal(v.proposed, t.fiat.amount);
    if (c.state === "settled") v.settled = addDecimal(v.settled, t.fiat.amount);
  }
  return {
    total: swaps.length,
    settled: settled.length,
    refunded: swaps.filter((c) => c.state === "refunded").length,
    disputed: swaps.filter((c) => c.state === "disputed").length,
    uncertain: swaps.filter((c) => c.issues.length).length,
    completionRate: swaps.length ? (settled.length / swaps.length) * 100 : null,
    settledSats: settled.reduce(
      (sum, c) => addDecimal(sum, c.swap!.bitcoin.amount),
      "0",
    ),
    volumes,
  };
}
