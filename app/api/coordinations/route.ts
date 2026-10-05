import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_RELAYS } from "../../../lib/pip00";
import { fetchFromRelays } from "../../../lib/nostr-relays";
import {
  parseRootId,
  reconstructCoordination,
} from "../../../lib/coordinations";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const configured = request.nextUrl.searchParams.getAll("relay");
  if (
    configured.length > 8 ||
    configured.some((value) => {
      try {
        const url = new URL(value);
        return (
          !["ws:", "wss:"].includes(url.protocol) ||
          !!url.username ||
          !!url.password
        );
      } catch {
        return true;
      }
    })
  )
    return NextResponse.json(
      { error: "Supply up to 8 valid WebSocket relay URLs." },
      { status: 400 },
    );
  const relays = configured.length
    ? [...new Set(configured)]
    : [...DEFAULT_RELAYS];
  const supplied = request.nextUrl.searchParams.getAll("root");
  const ids = supplied.map(parseRootId);
  if (ids.length > 50 || ids.some((id) => !id))
    return NextResponse.json(
      { error: "Supply up to 50 valid root IDs, note or nevent identifiers." },
      { status: 400 },
    );
  const roots = await fetchFromRelays(relays, {
    kinds: [7300],
    ...(ids.length ? { ids: ids as string[] } : {}),
    limit: 100,
  });
  const rootIds = roots.events.map((e) => e.id);
  const actions = rootIds.length
    ? await fetchFromRelays(relays, {
        kinds: [7301],
        "#e": rootIds,
        limit: 2000,
      })
    : { events: [], results: [] };
  const items = roots.events
    .map((root) => reconstructCoordination(root, actions.events))
    .filter((item) => item !== null);
  return NextResponse.json(
    {
      items,
      results: [
        ...roots.results.map((r) => ({ ...r, phase: "roots" })),
        ...actions.results.map((r) => ({ ...r, phase: "actions" })),
      ],
      missingRoots: ids.filter((id) => !rootIds.includes(id!)),
      excludedRoots: roots.events.length - items.length,
      readAt: new Date().toISOString(),
      bounded: true,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
