import { Box, Button, Container, Link, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { EscrowDefinitionCard } from "../../../components/escrow-definition-card";
import { escrowCoordinate } from "../../../lib/escrow-coordinate";
import { DEFAULT_RELAYS } from "../../../lib/pip00";
import { PIP01_ESCROW_KIND, parseEscrowEvent, type EscrowDescriptor } from "../../../lib/pip01";
import { parseLookupFilter } from "../../../lib/server/api-utils";
import { refreshEscrows } from "../../../lib/server/escrow-cache";
import type { NostrFilter } from "../../../lib/nostr-relays";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{
    coordinate: string[];
  }>;
};

export default async function EscrowPage({ params }: PageProps) {
  const { coordinate } = await params;
  const decodedCoordinate = coordinate.map((part) => decodeURIComponent(part)).join("/");
  const lookupFilter = parseLookupFilter(decodedCoordinate, PIP01_ESCROW_KIND);

  if (!lookupFilter) {
    notFound();
  }

  const snapshot = await refreshEscrows([...DEFAULT_RELAYS], lookupFilter);
  const escrow = snapshot.events
    .map(parseEscrowEvent)
    .find((candidate) => matchesLookupFilter(candidate, lookupFilter));

  if (!escrow) {
    return (
      <EscrowPageShell>
        <Stack spacing={2}>
          <Typography variant="h4" component="h1" sx={{ fontWeight: 900, overflowWrap: "anywhere" }}>
            Escrow not found
          </Typography>
          <Typography color="text.secondary" sx={{ overflowWrap: "anywhere" }}>
            {decodedCoordinate}
          </Typography>
          <Typography>No matching PIP-01 escrow descriptor was returned by the configured relays.</Typography>
          <RelayReadSummary results={snapshot.results} />
          <Button href="/escrows" variant="outlined" sx={{ alignSelf: "flex-start" }}>
            Back to directory
          </Button>
        </Stack>
      </EscrowPageShell>
    );
  }

  const resolvedCoordinate = escrowCoordinate(escrow);

  return (
    <EscrowPageShell>
      <Stack spacing={3}>
        <Stack spacing={1}>
          <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 800 }}>
            PIP-01 Escrow Descriptor
          </Typography>
          <Typography variant="h4" component="h1" sx={{ fontWeight: 900, overflowWrap: "anywhere" }}>
            {escrow.content?.escrow_type || escrow.escrowType || escrow.identifier}
          </Typography>
          <Typography color="text.secondary" sx={{ overflowWrap: "anywhere" }}>
            {resolvedCoordinate}
          </Typography>
        </Stack>
        <EscrowDefinitionCard escrow={escrow} />
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ justifyContent: "space-between" }}>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
            <Button href="/escrows" variant="outlined">
              Back to directory
            </Button>
            <Button href={`/escrows/publishing?escrow=${encodeURIComponent(resolvedCoordinate)}`} variant="contained">
              Edit in Publishing
            </Button>
          </Stack>
          <Link href="https://github.com/pontmore/protocol/blob/main/PIP-01-escrow-descriptor.md" target="_blank" rel="noreferrer">
            View PIP-01
          </Link>
        </Stack>
      </Stack>
    </EscrowPageShell>
  );
}

function EscrowPageShell({ children }: { children: ReactNode }) {
  return (
    <Box component="main" sx={{ minHeight: "100vh", py: { xs: 4, md: 7 } }}>
      <Container maxWidth="md">{children}</Container>
    </Box>
  );
}

function RelayReadSummary({ results }: { results: Array<{ relay: string; ok: boolean; message: string }> }) {
  if (results.length === 0) {
    return null;
  }

  return (
    <Stack spacing={0.75}>
      {results.map((result) => (
        <Typography variant="body2" color={result.ok ? "text.secondary" : "error"} key={result.relay}>
          {result.relay}: {result.message}
        </Typography>
      ))}
    </Stack>
  );
}

function matchesLookupFilter(escrow: EscrowDescriptor, filter: NostrFilter): boolean {
  const expectedKind = filter.kinds?.[0];
  const expectedAuthor = filter.authors?.[0];
  const expectedIdentifier = filter["#d"]?.[0];

  return (
    (!expectedKind || escrow.event.kind === expectedKind) &&
    (!expectedAuthor || escrow.event.pubkey === expectedAuthor) &&
    (!expectedIdentifier || escrow.identifier === expectedIdentifier)
  );
}
