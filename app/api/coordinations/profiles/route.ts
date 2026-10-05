import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_RELAYS } from "../../../../lib/pip00";
import { fetchFromRelays } from "../../../../lib/nostr-relays";
import {
  coordinationProfiles,
  parseRootId,
  reconstructCoordination,
} from "../../../../lib/coordinations";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const configured = request.nextUrl.searchParams.getAll("relay"),
    supplied = request.nextUrl.searchParams.getAll("root"),
    ids = supplied.map(parseRootId);
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
    }) ||
    ids.length > 50 ||
    ids.some((id) => !id)
  )
    return NextResponse.json(
      { error: "Invalid relay URLs or known root IDs." },
      { status: 400 },
    );
  const relays = configured.length
    ? [...new Set(configured)]
    : [...DEFAULT_RELAYS];
  const reads = await Promise.all([
    fetchFromRelays(relays, { kinds: [7300], limit: 100 }),
    ...(ids.length
      ? [
          fetchFromRelays(relays, {
            kinds: [7300],
            ids: ids as string[],
            limit: 50,
          }),
        ]
      : []),
  ]);
  const items = reads
    .flatMap((read) => read.events)
    .map((root) => reconstructCoordination(root, []))
    .filter((item) => item !== null);
  return NextResponse.json(
    {
      profiles: coordinationProfiles(items),
      results: reads.flatMap((read) => read.results),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
