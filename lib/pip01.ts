import { isRecord, isStringList, type NostrEvent, type UnsignedNostrEvent } from "./pip00";
export const PIP01_ESCROW_KIND = 30361;
export enum EscrowType {
  LightningHoldInvoice = "lightning_hold_invoice",
  CustodialEscrow = "custodial_escrow",
  CashuEscrow = "cashu_escrow",
}
export type EscrowDescriptorContent = {
  version: number; escrow_type: string; networks: string[]; expires_at: number;
  service?: { schema: { type: "openapi" | "asyncapi"; url: string } };
};
export type EscrowDescriptor = {
  event: NostrEvent; identifier: string; escrowType: string; networks: string[];
  content: EscrowDescriptorContent | null; malformedContent: boolean; validationErrors: string[];
};
export function validateEscrowEvent(event: UnsignedNostrEvent): string[] {
  const errors: string[] = [];
  if (event.kind !== PIP01_ESCROW_KIND) errors.push("Expected kind 30361.");
  if (event.tags.filter((tag) => tag[0] === "d").length !== 1 || !event.tags.find((tag) => tag[0] === "d")?.[1]) errors.push("One non-empty d tag is required.");
  let content: unknown;
  try { content = JSON.parse(event.content); } catch { return [...errors, "Content must be a JSON object."]; }
  if (!isRecord(content)) return [...errors, "Content must be a JSON object."];
  if (content.version !== 1) errors.push("Unsupported descriptor version; expected 1.");
  if (typeof content.escrow_type !== "string" || !/^[a-z0-9][a-z0-9_-]*$/.test(content.escrow_type)) errors.push("Escrow type must be a lowercase mechanism identifier.");
  if (!isStringList(content.networks) || !content.networks.length || content.networks.some((item) => !/^[a-z0-9][a-z0-9_-]*$/.test(item))) {
    errors.push("Networks must be a non-empty list of lowercase identifiers.");
  } else {
    const networks = content.networks;
    if (event.tags.some((tag) => tag[0] === "t" && tag[1]?.startsWith("pontmore-network:") && !networks.includes(tag[1].slice(17)))) errors.push("Network tags claim a network absent from content.networks.");
    if (content.escrow_type === EscrowType.LightningHoldInvoice && !networks.includes("lightning")) errors.push("Lightning hold invoices require lightning.");
    if (content.escrow_type === EscrowType.CashuEscrow && !networks.includes("cashu")) errors.push("Cashu escrow requires cashu.");
  }
  if (!Number.isSafeInteger(content.expires_at) || Number(content.expires_at) < 0) errors.push("expires_at must be a Unix timestamp.");
  if (content.service !== undefined) {
    const service = content.service;
    if (!isRecord(service) || Object.keys(service).some((key) => key !== "schema") || !isRecord(service.schema)) errors.push("Service must contain only schema.");
    else {
      if (!["openapi", "asyncapi"].includes(String(service.schema.type))) errors.push("Schema type must be openapi or asyncapi.");
      try {
        if (typeof service.schema.url !== "string") throw new Error();
        const url = new URL(service.schema.url);
        if (url.protocol !== "https:" || !url.hostname || url.username || url.password) throw new Error();
      } catch { errors.push("Schema URL must be an absolute HTTPS URL without credentials."); }
    }
  }
  return errors;
}
export function buildEscrowEvent({ pubkey, identifier, escrowType, networks, expiresAt, schemaType, schemaUrl }: {
  pubkey: string; identifier: string; escrowType: string; networks: string[]; expiresAt: number;
  schemaType: "openapi" | "asyncapi"; schemaUrl: string;
}): UnsignedNostrEvent {
  const values = [...new Set(networks.map((item) => item.trim().toLowerCase()).filter(Boolean))];
  const content: EscrowDescriptorContent = { version: 1, escrow_type: escrowType.trim(), networks: values, expires_at: expiresAt,
    ...(schemaUrl.trim() ? { service: { schema: { type: schemaType, url: schemaUrl.trim() } } } : {}) };
  const event = { pubkey, created_at: Math.floor(Date.now() / 1000), kind: PIP01_ESCROW_KIND,
    tags: [["d", identifier.trim() || "escrow"], ...values.map((item) => ["t", `pontmore-network:${item}`]), ["client", "pontmore-poc"]],
    content: JSON.stringify(content) };
  const errors = validateEscrowEvent(event);
  if (errors.length) throw new Error(errors.join(" "));
  return event;
}
export function parseEscrowEvent(event: NostrEvent): EscrowDescriptor {
  const validationErrors = validateEscrowEvent(event);
  const content: EscrowDescriptorContent | null = validationErrors.length ? null : JSON.parse(event.content);
  return { event, identifier: event.tags.find((tag) => tag[0] === "d")?.[1] || "escrow", escrowType: content?.escrow_type || "", networks: content?.networks || [], content,
    malformedContent: validationErrors.length > 0, validationErrors };
}
export function isEscrowExpired(escrow: EscrowDescriptor, now = Math.floor(Date.now() / 1000)): boolean {
  return !escrow.content || now >= escrow.content.expires_at;
}
