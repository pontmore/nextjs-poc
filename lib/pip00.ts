export const PIP00_AGENT_KIND = 30360;
export const DEFAULT_RELAYS = ["wss://nos.lol", "wss://relay.damus.io"] as const;
export type NostrTag = string[];
export type NostrEvent = { id: string; pubkey: string; created_at: number; kind: number; tags: NostrTag[]; content: string; sig: string };
export type UnsignedNostrEvent = Omit<NostrEvent, "id" | "sig">;
export type AgentDefinitionContent = { version: number; capabilities: string[] };
export type AgentDefinition = {
  event: NostrEvent; identifier: string; escrowAddress: string;
  content: AgentDefinitionContent | null; malformedContent: boolean; validationErrors: string[];
};
export const CAPABILITY_PATTERN = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*@[1-9][0-9]*$/;
export const ESCROW_ADDRESS_PATTERN = /^30361:[a-f0-9]{64}:.+$/;
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}
export function validateAgentEvent(event: UnsignedNostrEvent): string[] {
  const errors: string[] = [];
  if (event.kind !== PIP00_AGENT_KIND) errors.push("Expected kind 30360.");
  if (event.tags.filter((tag) => tag[0] === "d").length !== 1 || !event.tags.find((tag) => tag[0] === "d")?.[1]) errors.push("One non-empty d tag is required.");
  if (!event.tags.some((tag) => tag[0] === "t" && tag[1] === "agent")) errors.push("Missing agent tag.");
  let content: unknown;
  try { content = JSON.parse(event.content); } catch { return [...errors, "Content must be a JSON object."]; }
  if (!isRecord(content)) return [...errors, "Content must be a JSON object."];
  if (content.version !== 1) errors.push("Unsupported Agent definition version; expected 1.");
  if (!isStringList(content.capabilities) || !content.capabilities.length || content.capabilities.some((item) => !CAPABILITY_PATTERN.test(item))) {
    errors.push("Capabilities must be a non-empty list of namespace/capability@version identifiers.");
  } else {
    const capabilities = content.capabilities;
    const indexed = event.tags.filter((tag) => tag[0] === "t" && tag[1]?.startsWith("pontmore-capability:")).map((tag) => tag[1].slice(20));
    if (indexed.some((item) => !capabilities.includes(item)) || capabilities.some((item) => !indexed.includes(item))) errors.push("Capability tags must match content.capabilities.");
  }
  for (const key of ["pubkey", "created_at", "sig", "name", "about", "updated_at", "pricing_policy", "escrow"]) {
    if (key in content) errors.push(`${key} does not belong in a PIP-00 capability index.`);
  }
  for (const tag of event.tags.filter((tag) => tag[0] === "a" && (tag[3] === "escrow" || tag[1]?.startsWith("30361:")))) {
    if (!ESCROW_ADDRESS_PATTERN.test(tag[1]) || tag[3] !== "escrow") errors.push("Escrow reference requires a valid coordinate, relay hint, and escrow marker.");
  }
  return errors;
}
export function buildAgentEvent({ pubkey, identifier, capabilities, escrowAddress = "" }: {
  pubkey: string; identifier: string; capabilities: string[]; escrowAddress?: string;
}): UnsignedNostrEvent {
  const values = [...new Set(capabilities.map((item) => item.trim()).filter(Boolean))];
  const event = {
    pubkey, created_at: Math.floor(Date.now() / 1000), kind: PIP00_AGENT_KIND,
    tags: [["d", identifier.trim() || "agent"], ["t", "agent"], ...values.map((item) => ["t", `pontmore-capability:${item}`]),
      ...(escrowAddress.trim() ? [["a", escrowAddress.trim(), "", "escrow"]] : []), ["client", "pontmore-poc"]],
    content: JSON.stringify({ version: 1, capabilities: values }),
  };
  const errors = validateAgentEvent(event);
  if (errors.length) throw new Error(errors.join(" "));
  return event;
}
export function parseAgentEvent(event: NostrEvent): AgentDefinition {
  const validationErrors = validateAgentEvent(event);
  return { event, identifier: event.tags.find((tag) => tag[0] === "d")?.[1] || "agent",
    escrowAddress: event.tags.find((tag) => tag[0] === "a" && tag[3] === "escrow")?.[1] || "",
    content: validationErrors.length ? null : JSON.parse(event.content), malformedContent: validationErrors.length > 0, validationErrors };
}
export function parseList(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}
