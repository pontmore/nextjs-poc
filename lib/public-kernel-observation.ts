import type { Coordination, PublicAction } from "./coordinations";
export function observePublicKernelAction(
  root: Coordination["root"],
  roles: Coordination["roles"],
  expiresAt: number,
  state: string,
  beforeDispute: string,
  action: PublicAction,
  history: PublicAction[],
): string | null {
  const actor = action.event.pubkey,
    name = action.action,
    data = action.data;
  if (
    !Object.values(roles).includes(actor) ||
    action.event.created_at < root.created_at ||
    [
      "settled_claimed",
      "refunded_claimed",
      "cancelled_claimed",
      "declined_claimed",
      "expired_claimed",
    ].includes(state)
  )
    return null;
  const participant = Object.entries(roles).some(
    ([role, key]) => !role.startsWith("core/") && key === actor,
  );
  const escrow = roles["core/escrow"] === actor,
    accepted = history.some((a) => a.action === "core/accept"),
    secured = history.some((a) => a.action === "core/secure");
  if (!name.startsWith("core/"))
    return state === "disputed_claimed" ||
      !participant ||
      !/^[a-z0-9._-]+\/[a-z0-9._-]+$/.test(name)
      ? null
      : state === "proposed"
        ? "uninterpreted"
        : state;
  const allowed =
    name === "core/open_dispute"
      ? ["class", "evidence"]
      : name === "core/resolve_dispute"
        ? ["policy", "effect", "evidence"]
        : ["evidence"];
  if (Object.keys(data).some((key) => !allowed.includes(key))) return null;
  if (
    data.evidence !== undefined &&
    (!Array.isArray(data.evidence) ||
      data.evidence.some(
        (value) =>
          !value ||
          typeof value !== "object" ||
          Array.isArray(value) ||
          !["event", "commitment", "opaque"].includes(String(value.type)) ||
          typeof value.value !== "string" ||
          !value.value ||
          (value.type === "event" && !/^[0-9a-f]{64}$/.test(value.value)) ||
          (value.type === "commitment" &&
            !/^sha256:[0-9a-f]{64}$/.test(value.value)),
      ))
  )
    return null;
  if (state === "disputed_claimed" && name !== "core/resolve_dispute")
    return null;
  switch (name) {
    case "core/accept":
      return participant &&
        !secured &&
        action.event.created_at < expiresAt &&
        !history.some((a) => a.action === name && a.event.pubkey === actor)
        ? "accepted_claimed"
        : null;
    case "core/secure":
      return escrow && accepted && !secured ? "secured_claimed" : null;
    case "core/authorize_settlement":
      return participant && secured && !history.some((a) => a.action === name)
        ? "settlement_authorized_claimed"
        : null;
    case "core/settle":
      return escrow && state === "settlement_authorized_claimed"
        ? "settled_claimed"
        : null;
    case "core/authorize_refund":
      return participant && !history.some((a) => a.action === name)
        ? "refund_authorized_claimed"
        : null;
    case "core/refund":
      return escrow && state === "refund_authorized_claimed"
        ? "refunded_claimed"
        : null;
    case "core/cancel":
      return participant && !secured ? "cancelled_claimed" : null;
    case "core/decline":
      return participant && actor !== root.pubkey && !accepted
        ? "declined_claimed"
        : null;
    case "core/expire":
      return participant && !accepted && action.event.created_at >= expiresAt
        ? "expired_claimed"
        : null;
    case "core/open_dispute":
      return participant &&
        accepted &&
        (data.class === undefined || typeof data.class === "string")
        ? "disputed_claimed"
        : null;
    case "core/resolve_dispute": {
      if (
        actor !== roles["core/resolver"] ||
        state !== "disputed_claimed" ||
        typeof data.policy !== "string" ||
        !data.policy
      )
        return null;
      if (data.effect === "authorize_settlement" && !secured) return null;
      return (
        (
          {
            resume: beforeDispute,
            authorize_settlement: "settlement_authorized_claimed",
            authorize_refund: "refund_authorized_claimed",
            cancel: "cancelled_claimed",
          } as Record<string, string>
        )[String(data.effect)] || null
      );
    }
    default:
      return null;
  }
}
