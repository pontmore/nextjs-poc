"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  Link,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import {
  parseRootId,
  SWAP_PROFILE,
  coordinationProfiles,
  normalizeCoordinationProfile,
  coordinationProfileHref,
  type Coordination,
} from "../lib/coordinations";
import { CoordinationMetrics } from "./coordination-metrics";
import { DashboardShell } from "./agent-directory";
import { announceCoordinationProfiles } from "./use-coordination-profiles";
import type { RelayResult } from "../lib/nostr-relays";
type Snapshot = {
  items: Coordination[];
  results: (RelayResult & {
    phase: string;
  })[];
  missingRoots: string[];
  excludedRoots: number;
  readAt: string;
};
const STORAGE = "pontmore-known-coordination-roots";
const short = (id: string) => `${id.slice(0, 12)}…${id.slice(-6)}`;
const label = (state: string) => state.replaceAll("_", " ");
export function CoordinationViewer({
  swapsOnly = false,
  rootId,
  profileFilter,
  profileSlug,
}: {
  swapsOnly?: boolean;
  rootId?: string;
  profileFilter?: string;
  profileSlug?: string;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const readSequence = useRef(0);
  const [known, setKnown] = useState<string[]>([]),
    [input, setInput] = useState(""),
    [search, setSearch] = useState(""),
    [status, setStatus] = useState("all");
  const load = useCallback(
    async (ids: string[]) => {
      const sequence = ++readSequence.current;
      setLoading(true);
      setError("");
      try {
        const request = async (roots: string[]) => {
          const params = new URLSearchParams();
          roots.forEach((id) => params.append("root", id));
          try {
            (localStorage.getItem("pontmore-pip00-poc-relays") || "")
              .split(/[\s,]+/)
              .filter(Boolean)
              .forEach((relay) => params.append("relay", relay));
          } catch {
            /* Use defaults when storage is unavailable. */
          }
          const response = await fetch(`/api/coordinations?${params}`);
          const data = await response.json();
          if (!response.ok)
            throw new Error(data.error || "Unable to read coordinations.");
          return data as Snapshot;
        };
        const data = await request(rootId ? [rootId] : []);
        if (!rootId && ids.length) {
          const extra = await request(ids);
          data.items = [
            ...new Map(
              [...data.items, ...extra.items].map((c) => [c.root.id, c]),
            ).values(),
          ];
          data.results.push(...extra.results);
          data.missingRoots = extra.missingRoots;
          data.excludedRoots += extra.excludedRoots;
        }
        data.items.sort((a, b) => b.root.created_at - a.root.created_at);
        if (sequence === readSequence.current) {
          setSnapshot(data);
          announceCoordinationProfiles(coordinationProfiles(data.items));
        }
      } catch (e) {
        if (sequence === readSequence.current)
          setError(
            e instanceof Error ? e.message : "Unable to read coordinations.",
          );
      } finally {
        if (sequence === readSequence.current) setLoading(false);
      }
    },
    [rootId],
  );
  useEffect(() => {
    let ids: string[] = [];
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE) || "[]");
      if (Array.isArray(saved))
        ids = saved
          .filter(
            (id): id is string => typeof id === "string" && !!parseRootId(id),
          )
          .slice(0, 50);
    } catch {
      /* storage unavailable */
    }
    setKnown(ids);
    void load(ids);
  }, [load]);
  const items = snapshot?.items || [];
  const swaps = items.filter((c) => c.profile === SWAP_PROFILE);
  const slugItems = profileSlug
    ? items.filter(
        (c) => normalizeCoordinationProfile(c.profile) === profileSlug,
      )
    : items;
  const matchingProfiles = coordinationProfiles(slugItems);
  const ambiguousProfile =
    !!profileSlug && !profileFilter && matchingProfiles.length > 1;
  const resolvedProfile =
    profileFilter ||
    (profileSlug === normalizeCoordinationProfile(SWAP_PROFILE)
      ? SWAP_PROFILE
      : profileSlug && matchingProfiles.length === 1
        ? matchingProfiles[0]
        : undefined);
  const swapView = swapsOnly || resolvedProfile === SWAP_PROFILE;
  const categoryItems = ambiguousProfile
    ? []
    : resolvedProfile
      ? slugItems.filter((c) => c.profile === resolvedProfile)
      : swapView
        ? swaps
        : slugItems;
  const visible = categoryItems.filter(
    (c) =>
      (status === "all" || c.state === status) &&
      `${c.root.id} ${c.profile} ${c.swap?.fiat.currency || ""} ${c.swap?.bitcoin.network || ""} ${Object.values(c.roles).join(" ")}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const selected = rootId ? items.find((c) => c.root.id === rootId) : null;
  function addRoot() {
    const id = parseRootId(input);
    if (!id) {
      setError("Enter a 64-character root event ID, note or nevent.");
      return;
    }
    if (known.length >= 50 && !known.includes(id)) {
      setError("Up to 50 known roots can be saved.");
      return;
    }
    const ids = [...new Set([...known, id])];
    setKnown(ids);
    try {
      localStorage.setItem(STORAGE, JSON.stringify(ids));
    } catch {
      /* still usable in memory */
    }
    setInput("");
    void load(ids);
  }
  return (
    <DashboardShell
      activePage="coordinations"
      selectedCoordinationProfile={
        resolvedProfile || (swapView ? SWAP_PROFILE : selected?.profile)
      }
      pageTitle={
        rootId
          ? selected?.swap
            ? "Swap details"
            : "Coordination details"
          : swapView
            ? "Swaps"
            : profileSlug || "Coordinations"
      }
      pagePipLink={{
        href: "https://github.com/pontmore/protocol/blob/main/PIP-02-coordination-event-chains.md",
        label: "View PIP-02",
      }}
      pageMeta={
        rootId
          ? "Public root"
          : `${categoryItems.length} ${swapView ? "swaps" : "coordinations"}`
      }
    >
      <Stack spacing={2.5} sx={{ p: { xs: 2, md: 3 }, minWidth: 0 }}>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          sx={{ justifyContent: "space-between", gap: 2 }}
        >
          <Box>
            <Typography color="text.secondary" sx={{ mt: 1 }}>
              {swapView
                ? "Public fiat / Bitcoin swaps using pontmore/swap@1."
                : resolvedProfile
                  ? `Public coordinations using ${resolvedProfile}.`
                  : "Explore signed roots, participants and linked public actions."}
            </Typography>
          </Box>
          <Button
            variant="outlined"
            disabled={loading}
            onClick={() => void load(known)}
            sx={{ alignSelf: "center" }}
          >
            {loading ? "Reading relays…" : "Refresh"}
          </Button>
        </Stack>
        <Alert severity="info">
          Experimental public-chain observations. Descriptor selection, service
          policies, private commitments and actual payments are not
          independently verified. Reads cover at most 100 roots and 2,000
          actions per relay; metrics describe this loaded sample, not the whole
          network.
        </Alert>
        {error && <Alert severity="error">{error}</Alert>}
        {ambiguousProfile && (
          <Alert severity="warning">
            Multiple pinned profiles normalize to this URL. Select the intended
            profile:{" "}
            {matchingProfiles.map((profile) => (
              <Link
                key={profile}
                href={coordinationProfileHref(profile, matchingProfiles)}
                sx={{ display: "block" }}
              >
                {profile}
              </Link>
            ))}
          </Alert>
        )}

        {snapshot?.results.some(
          (r) => !r.ok || r.message.includes("partial"),
        ) && (
          <Alert severity="warning">
            Some relay reads failed or returned partial history. The displayed
            sample may be incomplete.
          </Alert>
        )}
        {!rootId && (
          <Card variant="outlined">
            <CardContent>
              <Stack spacing={2}>
                <Typography sx={{ fontWeight: 800 }}>
                  Track a known root
                </Typography>
                <Stack direction={{ xs: "column", sm: "row" }} sx={{ gap: 1 }}>
                  <TextField
                    fullWidth
                    size="small"
                    label="Root ID, note or nevent"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !loading) addRoot();
                    }}
                  />
                  <Button
                    variant="contained"
                    disabled={loading || !input.trim()}
                    onClick={addRoot}
                    sx={{ flexShrink: 0 }}
                  >
                    Add root
                  </Button>
                </Stack>
                {known.length > 0 && (
                  <Stack direction="row" sx={{ gap: 1, flexWrap: "wrap" }}>
                    {known.map((id) => (
                      <Chip
                        key={id}
                        label={short(id)}
                        onDelete={() => {
                          const ids = known.filter((k) => k !== id);
                          setKnown(ids);
                          try {
                            localStorage.setItem(STORAGE, JSON.stringify(ids));
                          } catch {
                            /* unavailable */
                          }
                          void load(ids);
                        }}
                      />
                    ))}
                  </Stack>
                )}
                <Typography variant="caption" color="text.secondary">
                  Known roots are saved in this browser and included alongside
                  relay discovery.
                </Typography>
              </Stack>
            </CardContent>
          </Card>
        )}
        {!rootId &&
          (profileSlug || profileFilter || swapsOnly) &&
          !ambiguousProfile && (
            <CoordinationMetrics
              items={categoryItems}
              profile={resolvedProfile}
            />
          )}
        {rootId ? (
          selected ? (
            <CoordinationDetail item={selected} />
          ) : (
            !loading && (
              <Alert severity="warning">
                This root was not returned as a supported PIP-02 version 2 root
                by the configured relays. It may be unavailable or use an
                unsupported format.
              </Alert>
            )
          )
        ) : (
          <>
            <Stack direction={{ xs: "column", sm: "row" }} sx={{ gap: 2 }}>
              <TextField
                fullWidth
                size="small"
                label="Search roots, profiles, participants, currencies or networks"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <TextField
                select
                size="small"
                label="State"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                slotProps={{ select: { native: true } }}
                sx={{ minWidth: 190 }}
              >
                <option value="all">All states</option>
                {[...new Set(categoryItems.map((c) => c.state))]
                  .sort()
                  .map((s) => (
                    <option value={s} key={s}>
                      {label(s)}
                    </option>
                  ))}
              </TextField>
            </Stack>
            <Typography color="text.secondary" variant="body2">
              {visible.length} {swapView ? "swaps" : "coordinations"}
            </Typography>
            {!loading && !visible.length && (
              <Card variant="outlined">
                <CardContent>
                  <Typography sx={{ fontWeight: 800 }}>
                    No {swapView ? "swaps" : "coordinations"} found
                  </Typography>
                  <Typography color="text.secondary">
                    Add a known root or refresh to read the configured public
                    relays.
                    {search || status !== "all"
                      ? " Try clearing your filters."
                      : ""}
                  </Typography>
                </CardContent>
              </Card>
            )}
            {visible.map((c) => (
              <Card variant="outlined" key={c.root.id}>
                <CardContent>
                  <Stack
                    direction={{ xs: "column", sm: "row" }}
                    sx={{ gap: 2, justifyContent: "space-between" }}
                  >
                    <Box>
                      <Link
                        href={`/coordinations/${c.root.id}`}
                        sx={{ fontWeight: 800 }}
                      >
                        {c.swap
                          ? `${c.swap.fiat.amount} ${c.swap.fiat.currency} ↔ ${c.swap.bitcoin.amount} sat`
                          : c.profile}
                      </Link>
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{ mt: 1 }}
                      >
                        {c.swap
                          ? `${c.swap.direction === "fiat_to_btc" ? "Fiat → Bitcoin" : "Bitcoin → Fiat"} · ${c.swap.bitcoin.network} · ${c.swap.payment_channel}`
                          : c.profile}
                      </Typography>
                      <Typography
                        variant="caption"
                        sx={{ display: "block", mt: 1 }}
                      >
                        {short(c.root.id)} ·{" "}
                        {new Date(c.root.created_at * 1000).toLocaleString()} ·{" "}
                        {c.history.length} linked actions
                      </Typography>
                    </Box>
                    <Chip
                      label={label(c.state)}
                      color={
                        c.issues.length
                          ? "warning"
                          : c.state === "settled"
                            ? "success"
                            : "default"
                      }
                      sx={{ alignSelf: "flex-start" }}
                    />
                  </Stack>
                  {c.issues.length > 0 && (
                    <Typography
                      variant="body2"
                      color="warning.main"
                      sx={{ mt: 1 }}
                    >
                      {c.issues.join(" ")}
                    </Typography>
                  )}
                </CardContent>
              </Card>
            ))}
          </>
        )}
        {snapshot && (
          <Stack spacing={1}>
            <Divider />
            <Typography variant="caption" color="text.secondary">
              Read {new Date(snapshot.readAt).toLocaleString()}.{" "}
              {snapshot.excludedRoots} unsupported or malformed roots excluded.
            </Typography>
            {snapshot.missingRoots.map((id) => (
              <Typography
                variant="body2"
                color="warning.main"
                key={id}
                sx={{ overflowWrap: "anywhere" }}
              >
                Known root unavailable: {id}
              </Typography>
            ))}
            <Box component="details">
              <Box component="summary" sx={{ cursor: "pointer" }}>
                Relay read details
              </Box>
              {snapshot.results.map((r, i) => (
                <Typography
                  variant="caption"
                  color={r.ok ? "text.secondary" : "error"}
                  key={i}
                  sx={{ display: "block" }}
                >
                  {r.phase} · {r.relay}: {r.message}
                </Typography>
              ))}
            </Box>
          </Stack>
        )}
      </Stack>
    </DashboardShell>
  );
}
function CoordinationDetail({ item: c }: { item: Coordination }) {
  return (
    <Stack spacing={3}>
      <Typography
        variant="body2"
        sx={{ overflowWrap: "anywhere", fontFamily: "monospace" }}
      >
        Root: {c.root.id}
      </Typography>
      <Chip
        label={`${c.profile} · ${label(c.state)}`}
        sx={{ alignSelf: "flex-start" }}
      />
      {c.issues.length > 0 && (
        <Alert severity="warning">{c.issues.join(" ")}</Alert>
      )}
      <Card variant="outlined">
        <CardContent>
          <Typography variant="h6" sx={{ fontWeight: 800 }}>
            Public terms
          </Typography>
          {c.swap ? (
            <Stack spacing={1} sx={{ mt: 2 }}>
              <Typography variant="h4" sx={{ fontWeight: 800 }}>
                {c.swap.fiat.amount} {c.swap.fiat.currency} ↔{" "}
                {c.swap.bitcoin.amount} sat
              </Typography>
              <Typography>
                {c.swap.direction === "fiat_to_btc"
                  ? "Customer sends fiat; agent provides Bitcoin."
                  : "Agent sends fiat; customer provides Bitcoin."}
              </Typography>
              <Typography>
                Network: {c.swap.bitcoin.network} · Channel:{" "}
                {c.swap.payment_channel}
              </Typography>
              <Typography>
                Fiat payment deadline:{" "}
                {new Date(c.swap.deadlines.fiat_pay_by * 1000).toLocaleString()}
              </Typography>
              <Typography>
                Fiat confirmation deadline:{" "}
                {new Date(
                  c.swap.deadlines.fiat_confirm_by * 1000,
                ).toLocaleString()}
              </Typography>
            </Stack>
          ) : (
            <Typography color="text.secondary">
              Profile-specific terms are available in the signed root below.
              Lifecycle semantics are not interpreted for this profile.
            </Typography>
          )}
          <Typography sx={{ mt: 2 }}>
            Acceptance deadline: {new Date(c.expiresAt * 1000).toLocaleString()}
          </Typography>
          <Typography variant="caption">
            Elapsed deadlines alone do not establish a terminal outcome.
          </Typography>
        </CardContent>
      </Card>
      <Card variant="outlined">
        <CardContent>
          <Typography variant="h6" sx={{ fontWeight: 800 }}>
            Participants & authorities
          </Typography>
          {Object.entries(c.roles).map(([role, key]) => (
            <Box key={role} sx={{ mt: 2 }}>
              <Typography sx={{ fontWeight: 700 }}>{role}</Typography>
              <Typography
                variant="body2"
                sx={{ overflowWrap: "anywhere", fontFamily: "monospace" }}
              >
                {key}
              </Typography>
            </Box>
          ))}
        </CardContent>
      </Card>
      <Card variant="outlined">
        <CardContent>
          <Typography variant="h6" sx={{ fontWeight: 800 }}>
            Linked history
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Ordered by predecessor links. Fork branches and unresolved actions
            remain available below.
          </Typography>
          <Stack spacing={2} sx={{ mt: 2 }}>
            <Typography>
              Root proposed ·{" "}
              {new Date(c.root.created_at * 1000).toLocaleString()}
            </Typography>
            {c.history.map((a, index) => (
              <Box key={a.event.id}>
                <Typography sx={{ fontWeight: 700 }}>
                  {index + 1}. {a.action}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {new Date(a.event.created_at * 1000).toLocaleString()} ·
                  signer {short(a.event.pubkey)}
                </Typography>
              </Box>
            ))}
          </Stack>
        </CardContent>
      </Card>
      <Box component="details">
        <Box component="summary" sx={{ cursor: "pointer", fontWeight: 700 }}>
          Signed public root and all linked action events
        </Box>
        <Typography
          component="pre"
          sx={{
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
            fontSize: 12,
          }}
        >
          {JSON.stringify({ root: c.root, actions: c.linkedEvents }, null, 2)}
        </Typography>
      </Box>
    </Stack>
  );
}
