import { validateAgentEvent } from "../../../../lib/pip00";
import { NextRequest, NextResponse } from "next/server";
import { isNostrEvent, publishToRelays } from "../../../../lib/nostr-relays";
import { parseRelays } from "../../../../lib/server/api-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  if (!isNostrEvent(body.event)) {
    return NextResponse.json({ error: "Invalid Nostr event." }, { status: 400 });
  }

  const errors = validateAgentEvent(body.event);
  if (errors.length) return NextResponse.json({ error: errors.join(" ") }, { status: 400 });

  const relays = parseRelays(body.relays);
  const results = await publishToRelays(relays, body.event);
  return NextResponse.json({ results });
}
