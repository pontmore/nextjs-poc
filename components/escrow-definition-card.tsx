"use client";

import {
  Alert,
  Box,
  Button,
  Card,
  CardActions,
  CardContent,
  Chip,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import DataObjectIcon from "@mui/icons-material/DataObject";
import IconButton from "@mui/material/IconButton";
import { nip19 } from "nostr-tools";
import type { ReactNode } from "react";
import { useState } from "react";
import { escrowCoordinate } from "../lib/escrow-coordinate";
import type { EscrowDescriptor } from "../lib/pip01";

export function EscrowDefinitionCard({ escrow }: { escrow: EscrowDescriptor }) {
  const [coordinateCopyState, setCoordinateCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [npubCopyState, setNpubCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [definitionCopyState, setDefinitionCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [showJson, setShowJson] = useState(false);
  const coordinate = escrowCoordinate(escrow);
  const npub = nip19.npubEncode(escrow.event.pubkey);
  const escrowJson = JSON.stringify(
    {
      coordinate,
      npub,
      identifier: escrow.identifier,
      content: escrow.content,
      event: escrow.event,
    },
    null,
    2,
  );

  return (
    <Card
      variant="outlined"
      sx={{
        borderColor: "rgba(240, 140, 0, 0.35)",
        borderTop: 4,
        borderTopColor: "secondary.main",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <CardContent sx={{ flexGrow: 1, display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
        <Stack spacing={1.5} sx={{ flexGrow: 1, minHeight: 0 }}>
          <Stack direction="row" spacing={1} sx={{ justifyContent: "space-between", alignItems: "center" }}>
            <Chip label={escrow.identifier} size="small" color="secondary" variant="outlined" />
            <Typography variant="caption" color="text.secondary">
              {formatEventTime(escrow.event.created_at)}
            </Typography>
          </Stack>
          {showJson ? (
            <Paper
              variant="outlined"
              component="pre"
              sx={{
                m: 0,
                p: 1.5,
                maxHeight: 520,
                overflow: "auto",
                fontFamily: "monospace",
                fontSize: 12,
                whiteSpace: "pre-wrap",
                overflowWrap: "anywhere",
              }}
            >
              {escrowJson}
            </Paper>
          ) : (
            <Stack spacing={1.5}>
              <Typography variant="h6" component="h2" sx={{ fontWeight: 800 }}>
                {escrow.content?.escrow_type || escrow.escrowType || "Unnamed escrow"}
              </Typography>
              <CopyableDetail
                label="Coordinate"
                value={coordinate}
                copyState={coordinateCopyState}
                onCopy={() => copyValue(coordinate, setCoordinateCopyState)}
              />
              <CopyableDetail
                label="Operator npub"
                value={npub}
                copyState={npubCopyState}
                onCopy={() => copyValue(npub, setNpubCopyState)}
              />
              <Detail label="Networks">
                <ValuePills values={escrow.content?.networks || escrow.networks} />
              </Detail>
              {escrow.validationErrors.length ? <Alert severity="error">{escrow.validationErrors.join(" ")}</Alert> : null}
              <Detail label="Selection lifetime">{escrow.content ? `${escrow.content.expires_at <= Math.floor(Date.now() / 1000) ? "Expired" : "Valid until"} (${escrow.content.expires_at} Unix seconds)` : "Invalid descriptor"}</Detail>
              <Detail label="Service schema type">{escrow.content?.service?.schema.type || "No service interface"}</Detail>
              <Detail label="Service schema URL">{escrow.content?.service?.schema.url || "None"}</Detail>
            </Stack>
          )}
        </Stack>
      </CardContent>
      <CardActions
        sx={{
          mt: "auto",
          px: 2,
          py: 1.5,
          borderTop: 1,
          borderColor: "divider",
          justifyContent: "flex-end",
          alignItems: "center",
        }}
      >
        <Tooltip title={showJson ? "Show escrow summary" : "Show escrow JSON"}>
          <IconButton
            size="small"
            color={showJson ? "primary" : "default"}
            aria-label={showJson ? "Show escrow summary" : "Show escrow JSON"}
            onClick={() => setShowJson((current) => !current)}
          >
            <DataObjectIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Button variant="outlined" size="small" onClick={() => copyValue(escrowJson, setDefinitionCopyState)}>
          {definitionCopyState === "copied" ? "Copied" : "Copy definition"}
        </Button>
      </CardActions>
      {definitionCopyState === "failed" ? <Alert severity="error" sx={{ mx: 2, mb: 2 }}>Clipboard write failed.</Alert> : null}
    </Card>
  );
}

function CopyableDetail({
  label,
  value,
  copyState,
  onCopy,
}: {
  label: string;
  value: string;
  copyState: "idle" | "copied" | "failed";
  onCopy: () => void;
}) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 800, textTransform: "uppercase" }}>{label}</Typography>
      <Stack direction="row" spacing={1} sx={{ alignItems: "start" }}>
        <Typography component="div" variant="body2" sx={{ flex: 1, overflowWrap: "anywhere" }}>{value}</Typography>
        <Button variant="outlined" size="small" onClick={onCopy}>
          {copyState === "copied" ? "Copied" : "Copy"}
        </Button>
      </Stack>
      {copyState === "failed" ? <Alert severity="error" sx={{ mt: 1 }}>Clipboard write failed.</Alert> : null}
    </Box>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 800, textTransform: "uppercase" }}>{label}</Typography>
      <Typography component="div" variant="body2" sx={{ overflowWrap: "anywhere" }}>{children}</Typography>
    </Box>
  );
}

function ValuePills({ values }: { values: string[] | undefined }) {
  const normalizedValues = values?.filter(Boolean) ?? [];
  if (normalizedValues.length === 0) {
    return "None";
  }

  return (
    <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: "wrap" }}>
      {normalizedValues.map((value) => (
        <Chip label={formatProtocolValue(value)} size="small" variant="outlined" key={value} />
      ))}
    </Stack>
  );
}

async function copyValue(value: string, setState: (state: "idle" | "copied" | "failed") => void) {
  if (!value) {
    return;
  }

  try {
    await navigator.clipboard.writeText(value);
    setState("copied");
    window.setTimeout(() => setState("idle"), 1800);
  } catch {
    setState("failed");
  }
}

function formatEventTime(createdAt: number): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(createdAt * 1000));
}

function formatProtocolValue(value: string): string {
  if (value.includes("-to-")) {
    return value
      .split("-to-")
      .map(formatProtocolValue)
      .join(" -> ");
  }

  return value
    .split(/[-_\s]/)
    .filter(Boolean)
    .map((part) => part.toUpperCase())
    .join(" ");
}
