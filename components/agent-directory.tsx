"use client";

import {
  Alert,
  AppBar,
  Autocomplete,
  Box,
  Button,
  Card,
  CardActions,
  CardContent,
  Chip,
  Divider,
  FormControl,
  IconButton,
  InputLabel,
  Link,
  List,
  ListItemButton,
  ListItemText,
  Menu,
  MenuItem,
  OutlinedInput,
  Paper,
  Select,
  Stack,
  TextField,
  Toolbar,
  Tooltip,
  Typography,
  type SelectChangeEvent,
  Drawer,
} from "@mui/material";
import DataObjectIcon from "@mui/icons-material/DataObject";
import FilterListIcon from "@mui/icons-material/FilterList";
import MenuIcon from "@mui/icons-material/Menu";
import SearchIcon from "@mui/icons-material/Search";
import { finalizeEvent, generateSecretKey, getPublicKey, nip19 } from "nostr-tools";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { escrowCoordinate } from "../lib/escrow-coordinate";
import {
  buildAgentEvent,
  DEFAULT_RELAYS,
  PIP00_AGENT_KIND,
  parseAgentEvent,
  parseList,
  type AgentDefinition,
  type NostrEvent,
} from "../lib/pip00";
import {
  buildEscrowEvent,
  EscrowType,
  PIP01_ESCROW_KIND,
  parseEscrowEvent,
  type EscrowDescriptor,
} from "../lib/pip01";

const SECRET_KEY_STORAGE = "pontmore-pip00-poc-secret-key";
const AGENT_SECRET_KEY_STORAGE = "pontmore-pip00-poc-agent-secret-key";
const ESCROW_SECRET_KEY_STORAGE = "pontmore-pip00-poc-escrow-secret-key";
const RELAYS_STORAGE = "pontmore-pip00-poc-relays";
const LOGO_SRC = "/logo.svg";
const PROFILE_KIND = 0;

type PublishState = "idle" | "publishing" | "published" | "failed";
type DirectoryState = "idle" | "loading" | "loaded" | "failed";
type ActiveTab = "discover" | "publish" | "escrow-discover" | "escrow-publish" | "profile" | "settings";
type ApiRelayResult = {
  relay: string;
  ok: boolean;
  message: string;
};
type DirectorySnapshot = {
  events: NostrEvent[];
  results: ApiRelayResult[];
  lastRefreshAt: string | null;
  refreshing: boolean;
};
type ProfileContent = {
  name?: string;
  display_name?: string;
  about?: string;
  picture?: string;
  banner?: string;
  website?: string;
  nip05?: string;
  lud16?: string;
};
type ProfileSnapshot = {
  events: NostrEvent[];
  results: ApiRelayResult[];
};
type AuthSession =
  | { type: "nip07"; pubkey: string }
  | { type: "local"; pubkey: string; secretKey: Uint8Array };
type AuthStatus = "idle" | "connecting" | "creating" | "failed";
type FilterField = {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
  formatOption?: (option: string) => string;
};
type RelayFooterConfig = {
  title: string;
  lines: string[];
  severity: "info" | "error";
};
type NostrExtension = {
  getPublicKey?: () => Promise<string>;
  signEvent?: (event: Omit<NostrEvent, "id" | "sig">) => Promise<NostrEvent>;
};

declare global {
  interface Window {
    nostr?: NostrExtension;
  }
}

enum Network {
  Bitcoin = "bitcoin",
  Lightning = "lightning",
  Cashu = "cashu",
}
const ESCROW_TYPE_OPTIONS = enumOptions(EscrowType);
const NETWORK_OPTIONS = enumValues(Network);
const DRAWER_WIDTH = 272;
const AGENT_D_TAG = "agent";
const ESCROW_D_TAG = "escrow";
const NAV_ITEMS: { value: ActiveTab; label: string }[] = [
  { value: "discover", label: "Agent Discovery" },
  { value: "publish", label: "Agent Publishing" },
  { value: "escrow-discover", label: "Escrow Discovery" },
  { value: "escrow-publish", label: "Escrow Publishing" },
  { value: "settings", label: "Settings" },
];
const PIP_LINKS: Partial<Record<ActiveTab, { href: string; label: string }>> = {
  discover: {
    href: "https://github.com/pontmore/protocol/blob/main/PIP-00-agent-definition.md",
    label: "View PIP-00",
  },
  publish: {
    href: "https://github.com/pontmore/protocol/blob/main/PIP-00-agent-definition.md",
    label: "View PIP-00",
  },
  "escrow-discover": {
    href: "https://github.com/pontmore/protocol/blob/main/PIP-01-escrow-descriptor.md",
    label: "View PIP-01",
  },
  "escrow-publish": {
    href: "https://github.com/pontmore/protocol/blob/main/PIP-01-escrow-descriptor.md",
    label: "View PIP-01",
  },
  profile: {
    href: "https://github.com/nostr-protocol/nips/blob/master/01.md",
    label: "View NIP-01",
  },
};

export function AgentDirectory() {
  const [activeTab, setActiveTab] = useState<ActiveTab>("discover");
  const [authSession, setAuthSession] = useState<AuthSession | null>(null);
  const [authStatus, setAuthStatus] = useState<AuthStatus>("idle");
  const [authMessage, setAuthMessage] = useState("");
  const [profileState, setProfileState] = useState<PublishState>("idle");
  const [profileLog, setProfileLog] = useState<string[]>([]);
  const [profileName, setProfileName] = useState("");
  const [profileDisplayName, setProfileDisplayName] = useState("");
  const [profileAbout, setProfileAbout] = useState("");
  const [profilePicture, setProfilePicture] = useState("");
  const [profileBanner, setProfileBanner] = useState("");
  const [profileWebsite, setProfileWebsite] = useState("");
  const [profileNip05, setProfileNip05] = useState("");
  const [profileLud16, setProfileLud16] = useState("");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [relays, setRelays] = useState<string[]>([...DEFAULT_RELAYS]);
  const [relayInput, setRelayInput] = useState([...DEFAULT_RELAYS].join("\n"));
  const [settingsState, setSettingsState] = useState<"idle" | "saved" | "failed">("idle");
  const [agentSecretKey, setAgentSecretKey] = useState<Uint8Array | null>(null);
  const [escrowSecretKey, setEscrowSecretKey] = useState<Uint8Array | null>(null);
  const [capabilities, setCapabilities] = useState("pontmore/swap@1");
  const [escrowAddress, setEscrowAddress] = useState("");
  const [publishState, setPublishState] = useState<PublishState>("idle");
  const [publishLog, setPublishLog] = useState<string[]>([]);
  const [directoryState, setDirectoryState] = useState<DirectoryState>("idle");
  const [directoryLog, setDirectoryLog] = useState<string[]>([]);
  const [agents, setAgents] = useState<AgentDefinition[]>([]);
  const [coordinate, setCoordinate] = useState("");
  const [agentLookupFilter, setAgentLookupFilter] = useState("");
  const [escrowDirectoryState, setEscrowDirectoryState] = useState<DirectoryState>("idle");
  const [escrowDirectoryLog, setEscrowDirectoryLog] = useState<string[]>([]);
  const [escrows, setEscrows] = useState<EscrowDescriptor[]>([]);
  const [escrowCoordinateInput, setEscrowCoordinateInput] = useState("");
  const [escrowLookupFilter, setEscrowLookupFilter] = useState("");
  const [escrowPublishState, setEscrowPublishState] = useState<PublishState>("idle");
  const [escrowPublishLog, setEscrowPublishLog] = useState<string[]>([]);
  const [escrowType, setEscrowType] = useState<string>(EscrowType.LightningHoldInvoice);
  const [escrowNetworks, setEscrowNetworks] = useState<string[]>([Network.Lightning]);
  const [expiresAt, setExpiresAt] = useState(() => String(Math.floor(Date.now() / 1000) + 86400));
  const [schemaType, setSchemaType] = useState<"openapi" | "asyncapi">("openapi");
  const [schemaUrl, setSchemaUrl] = useState("");
  const [capabilityFilter, setCapabilityFilter] = useState("");
  const [escrowFilter, setEscrowFilter] = useState("");
  const [escrowTypeFilter, setEscrowTypeFilter] = useState("");
  const [escrowNetworkFilter, setEscrowNetworkFilter] = useState("");
  const [escrowSchemaTypeFilter, setEscrowSchemaTypeFilter] = useState("");

  useEffect(() => {
    const stored = window.localStorage.getItem(SECRET_KEY_STORAGE);
    if (!stored) {
      return;
    }

    const secret = hexToBytes(stored);
    setAuthSession({ type: "local", pubkey: getPublicKey(secret), secretKey: secret });
  }, []);

  useEffect(() => {
    const stored = window.localStorage.getItem(AGENT_SECRET_KEY_STORAGE);
    if (stored) {
      setAgentSecretKey(hexToBytes(stored));
    }
  }, []);

  useEffect(() => {
    const stored = window.localStorage.getItem(ESCROW_SECRET_KEY_STORAGE);
    if (stored) {
      setEscrowSecretKey(hexToBytes(stored));
    }
  }, []);

  useEffect(() => {
    const stored = window.localStorage.getItem(RELAYS_STORAGE);
    if (!stored) {
      return;
    }

    const parsed = parseRelayInput(stored);
    if (parsed.length === 0) {
      return;
    }

    setRelays(parsed);
    setRelayInput(parsed.join("\n"));
  }, []);

  useEffect(() => {
    void loadCachedAgents(true);
    void loadCachedEscrows(true);
  }, [relays]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get("tab");
    const escrow = params.get("escrow");
    if (tab !== "escrow-publish" || !escrow) {
      return;
    }

    setActiveTab("escrow-publish");
    void loadEscrowDefinitionForCoordinate(escrow);
  }, [relays]);

  useEffect(() => {
    if (escrowType !== EscrowType.LightningHoldInvoice && escrowType !== EscrowType.CashuEscrow) {
      return;
    }

    setEscrowNetworks([escrowType === EscrowType.CashuEscrow ? Network.Cashu : Network.Lightning]);

  }, [escrowType]);

  const sessionPubkey = authSession?.pubkey ?? "";
  const agentPubkey = useMemo(() => (agentSecretKey ? getPublicKey(agentSecretKey) : sessionPubkey), [agentSecretKey, sessionPubkey]);
  const pubkey = agentPubkey;
  const npub = useMemo(() => (pubkey ? nip19.npubEncode(pubkey) : ""), [pubkey]);
  const escrowPubkey = useMemo(() => (escrowSecretKey ? getPublicKey(escrowSecretKey) : sessionPubkey), [escrowSecretKey, sessionPubkey]);
  const escrowNpub = useMemo(() => (escrowPubkey ? nip19.npubEncode(escrowPubkey) : ""), [escrowPubkey]);
  const effectiveEscrowAddress = escrowAddress.trim();
  const escrowAddressOptions = useMemo(() => {
    const discovered = escrows.filter((escrow) => escrow.content && escrow.content.expires_at > Math.floor(Date.now() / 1000)).map((escrow) => ({
      label: `${escrow.content?.escrow_type || escrow.escrowType || "Escrow"} (${escrow.identifier})`,
      value: escrowCoordinate(escrow),
    }));
    const fallback = effectiveEscrowAddress
      ? [{ label: `Default (${effectiveEscrowAddress})`, value: effectiveEscrowAddress }]
      : [];

    return uniqueByValue([...discovered, ...fallback]);
  }, [effectiveEscrowAddress, escrows]);
  const filterOptions = useMemo(() => buildFilterOptions(agents), [agents]);
  const escrowFilterOptions = useMemo(() => buildEscrowFilterOptions(escrows), [escrows]);
  const filteredAgents = useMemo(
    () =>
      agents.filter((agent) => (
        matchesLookup(agent.event.kind, agent.event.pubkey, agent.identifier, agentLookupFilter) &&
        matchesFilter(agent.content?.capabilities, capabilityFilter) &&
        matchesFilter([selectedEscrow(agent)], escrowFilter)
      )),
    [agentLookupFilter, agents, escrowFilter, capabilityFilter],
  );
  const filteredEscrows = useMemo(
    () =>
      escrows.filter((escrow) => (
        matchesLookup(escrow.event.kind, escrow.event.pubkey, escrow.identifier, escrowLookupFilter) &&
        matchesFilter([escrow.content?.escrow_type || escrow.escrowType], escrowTypeFilter) &&
        matchesFilter(escrow.content?.networks || escrow.networks, escrowNetworkFilter) &&
        matchesFilter([escrow.content?.service?.schema.type || ""], escrowSchemaTypeFilter)
      )),
    [escrowLookupFilter, escrowNetworkFilter, escrowSchemaTypeFilter, escrowTypeFilter, escrows],
  );
  const activeFilterCount = [agentLookupFilter, capabilityFilter, escrowFilter].filter(Boolean).length;
  const activeEscrowFilterCount = [escrowLookupFilter, escrowTypeFilter, escrowNetworkFilter, escrowSchemaTypeFilter].filter(Boolean).length;
  const isLightningHoldEscrow = escrowType === EscrowType.LightningHoldInvoice;
  const isCashuEscrow = escrowType === EscrowType.CashuEscrow;
  const escrowNetworkOptions = isLightningHoldEscrow ? [Network.Lightning] : isCashuEscrow ? [Network.Cashu] : NETWORK_OPTIONS;
  const pageTitle = NAV_ITEMS.find((item) => item.value === activeTab)?.label ?? "Pontmore Protocol Next POC";
  const pagePipLink = PIP_LINKS[activeTab];
  const pageMeta = activeTab === "discover"
    ? `${filteredAgents.length} / ${agents.length} agents`
    : activeTab === "escrow-discover"
      ? `${filteredEscrows.length} / ${escrows.length} escrows`
      : null;
  const topBarAction = activeTab === "discover"
    ? (
        <Button variant="contained" onClick={refreshDirectory} disabled={directoryState === "loading"}>
          {directoryState === "loading" ? "Refreshing..." : "Refresh agents"}
        </Button>
      )
    : activeTab === "escrow-discover"
      ? (
          <Button variant="contained" onClick={refreshEscrowDirectory} disabled={escrowDirectoryState === "loading"}>
            {escrowDirectoryState === "loading" ? "Refreshing..." : "Refresh escrows"}
          </Button>
      )
    : null;

  async function signAgentEvent(unsignedEvent: Omit<NostrEvent, "id" | "sig">): Promise<NostrEvent> {
    if (agentSecretKey) {
      return finalizeEvent(unsignedEvent, agentSecretKey) as NostrEvent;
    }

    return signSessionEvent(unsignedEvent);
  }

  async function signSessionEvent(unsignedEvent: Omit<NostrEvent, "id" | "sig">): Promise<NostrEvent> {
    if (!authSession) {
      throw new Error("Sign in before publishing.");
    }

    if (authSession.type === "local") {
      return finalizeEvent(unsignedEvent, authSession.secretKey) as NostrEvent;
    }

    const signed = await window.nostr?.signEvent?.(unsignedEvent);
    if (!signed || signed.pubkey !== authSession.pubkey) {
      throw new Error("NIP-07 signer returned a different identity.");
    }

    return signed;
  }

  async function signEscrowEvent(unsignedEvent: Omit<NostrEvent, "id" | "sig">): Promise<NostrEvent> {
    if (escrowSecretKey) {
      return finalizeEvent(unsignedEvent, escrowSecretKey) as NostrEvent;
    }

    return signSessionEvent(unsignedEvent);
  }

  function buildProfileEvent(): Omit<NostrEvent, "id" | "sig"> {
    const content: ProfileContent = {
      name: profileName.trim() || undefined,
      display_name: profileDisplayName.trim() || undefined,
      about: profileAbout.trim() || undefined,
      picture: profilePicture.trim() || undefined,
      banner: profileBanner.trim() || undefined,
      website: profileWebsite.trim() || undefined,
      nip05: profileNip05.trim() || undefined,
      lud16: profileLud16.trim() || undefined,
    };

    return {
      pubkey: sessionPubkey,
      created_at: Math.floor(Date.now() / 1000),
      kind: PROFILE_KIND,
      tags: [],
      content: JSON.stringify(removeEmptyProfileFields(content)),
    };
  }

  async function publishProfile() {
    if (!authSession || !sessionPubkey) {
      return;
    }

    setProfileState("publishing");
    setProfileLog([]);

    try {
      const event = await signSessionEvent(buildProfileEvent());
      const response = await fetch("/api/profile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ relays, event }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Publish rejected.");
      const results = Array.isArray(payload.results) ? payload.results as ApiRelayResult[] : [];
      setProfileLog(results.map((result) => `${result.relay}: ${result.ok ? "OK" : "failed"} - ${result.message}`));
      setProfileState(results.some((result) => result.ok) ? "published" : "failed");
    } catch {
      setProfileLog(["Profile publish failed. Check the signer and relay connection."]);
      setProfileState("failed");
    }
  }

  async function loadProfileForIdentity(identityPubkey: string) {
    try {
      const response = await fetch(`/api/profile?${relaySearchParams(relays)}&pubkey=${encodeURIComponent(identityPubkey)}`, { cache: "no-store" });
      if (!response.ok) {
        return;
      }

      const snapshot = await response.json() as ProfileSnapshot;
      const latest = snapshot.events[0];
      if (!latest?.content) {
        return;
      }

      const parsed = JSON.parse(latest.content) as ProfileContent;
      prefillProfileForm(parsed);
    } catch {
      setProfileLog(["Unable to load Nostr profile metadata."]);
    }
  }

  function prefillProfileForm(profile: ProfileContent) {
    setProfileName(profile.name || "");
    setProfileDisplayName(profile.display_name || "");
    setProfileAbout(profile.about || "");
    setProfilePicture(profile.picture || "");
    setProfileBanner(profile.banner || "");
    setProfileWebsite(profile.website || "");
    setProfileNip05(profile.nip05 || "");
    setProfileLud16(profile.lud16 || "");
  }

  async function publishAgent() {
    if (!authSession || !pubkey) {
      return;
    }

    setPublishState("publishing");
    setPublishLog([]);

    try {
      const unsignedEvent = buildAgentEvent({ pubkey, identifier: AGENT_D_TAG, capabilities: parseList(capabilities), escrowAddress: effectiveEscrowAddress });
      const event = await signAgentEvent(unsignedEvent);
      const response = await fetch("/api/agents/publish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ relays, event }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Publish rejected.");
      const results = Array.isArray(payload.results) ? payload.results as ApiRelayResult[] : [];
      setPublishLog(results.map((result) => `${result.relay}: ${result.ok ? "OK" : "failed"} - ${result.message}`));
      setPublishState(results.some((result) => result.ok) ? "published" : "failed");
    } catch (error) {
      setPublishLog([error instanceof Error ? error.message : "Publish failed."]);
      setPublishState("failed");
    }
  }

  async function loadCachedAgents(background = false) {
    if (!background) {
      setDirectoryState("loading");
      setDirectoryLog([]);
    }

    try {
      const response = await fetch(`/api/agents?${relaySearchParams(relays)}`, { cache: "no-store" });
      const snapshot = await response.json() as DirectorySnapshot;
      applyAgentSnapshot(snapshot);
      setDirectoryState("loaded");

      if (snapshot.refreshing) {
        window.setTimeout(() => {
          void loadCachedAgents(true);
        }, 1600);
      }
    } catch {
      setDirectoryLog(["Unable to load server-side agent cache."]);
      setDirectoryState("failed");
    }
  }

  async function refreshDirectory() {
    setDirectoryState("loading");
    setDirectoryLog([]);

    const response = await fetch("/api/agents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ relays }),
    });
    const result = await response.json() as DirectorySnapshot;

    applyAgentSnapshot(result);
    setDirectoryState(result.results.some((item) => item.ok) || result.events.length > 0 ? "loaded" : "failed");
  }

  async function lookupCoordinate() {
    const lookupValue = coordinate.trim();
    if (!lookupValue) {
      setAgentLookupFilter("");
      setDirectoryLog(["Enter a pubkey or addressable coordinate."]);
      setDirectoryState("failed");
      return;
    }

    setAgentLookupFilter(lookupValue);
    setDirectoryState("loading");
    setDirectoryLog([]);

    const response = await fetch("/api/agents/lookup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ relays, coordinate: lookupValue }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      setDirectoryLog([typeof payload.error === "string" ? payload.error : "Lookup failed."]);
      setDirectoryState("failed");
      return;
    }
    const result = await response.json() as DirectorySnapshot;
    const lookedUpAgents = result.events.map(parseAgentEvent);
    setAgents((current) => mergeDirectoryItems(current, lookedUpAgents));
    setDirectoryLog(result.results.map((item) => `${item.relay}: ${item.ok ? "OK" : "failed"} - ${item.message}`));
    setDirectoryState(result.results.some((item) => item.ok) || result.events.length > 0 ? "loaded" : "failed");
  }

  function applyAgentSnapshot(snapshot: DirectorySnapshot) {
    setAgents(snapshot.events.map(parseAgentEvent));
    setDirectoryLog(snapshot.results.map((item) => `${item.relay}: ${item.ok ? "OK" : "failed"} - ${item.message}`));
  }

  async function publishEscrow() {
    if (!authSession || !escrowPubkey) {
      return;
    }

    setEscrowPublishState("publishing");
    setEscrowPublishLog([]);

    try {
      const unsignedEvent = buildEscrowEvent({ pubkey: escrowPubkey, identifier: ESCROW_D_TAG,
        escrowType, networks: escrowNetworks, expiresAt: Number(expiresAt), schemaType, schemaUrl });
      const event = await signEscrowEvent(unsignedEvent);
      const response = await fetch("/api/escrows/publish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ relays, event }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Publish rejected.");
      const results = Array.isArray(payload.results) ? payload.results as ApiRelayResult[] : [];
      setEscrowPublishLog(results.map((result) => `${result.relay}: ${result.ok ? "OK" : "failed"} - ${result.message}`));
      setEscrowPublishState(results.some((result) => result.ok) ? "published" : "failed");
    } catch (error) {
      setEscrowPublishLog([error instanceof Error ? error.message : "Escrow publish failed."]);
      setEscrowPublishState("failed");
    }
  }

  async function loadCachedEscrows(background = false) {
    if (!background) {
      setEscrowDirectoryState("loading");
      setEscrowDirectoryLog([]);
    }

    try {
      const response = await fetch(`/api/escrows?${relaySearchParams(relays)}`, { cache: "no-store" });
      const snapshot = await response.json() as DirectorySnapshot;
      applyEscrowSnapshot(snapshot);
      setEscrowDirectoryState("loaded");

      if (snapshot.refreshing) {
        window.setTimeout(() => {
          void loadCachedEscrows(true);
        }, 1600);
      }
    } catch {
      setEscrowDirectoryLog(["Unable to load server-side escrow cache."]);
      setEscrowDirectoryState("failed");
    }
  }

  async function refreshEscrowDirectory() {
    setEscrowDirectoryState("loading");
    setEscrowDirectoryLog([]);

    const response = await fetch("/api/escrows", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ relays }),
    });
    const result = await response.json() as DirectorySnapshot;
    applyEscrowSnapshot(result);
    setEscrowDirectoryState(result.results.some((item) => item.ok) || result.events.length > 0 ? "loaded" : "failed");
  }

  async function lookupEscrowCoordinate() {
    const lookupValue = escrowCoordinateInput.trim();
    if (!lookupValue) {
      setEscrowLookupFilter("");
      setEscrowDirectoryLog(["Enter an escrow pubkey or addressable coordinate."]);
      setEscrowDirectoryState("failed");
      return;
    }

    setEscrowLookupFilter(lookupValue);
    setEscrowDirectoryState("loading");
    setEscrowDirectoryLog([]);

    const response = await fetch("/api/escrows/lookup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ relays, coordinate: lookupValue }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      setEscrowDirectoryLog([typeof payload.error === "string" ? payload.error : "Escrow lookup failed."]);
      setEscrowDirectoryState("failed");
      return;
    }

    const result = await response.json() as DirectorySnapshot;
    const lookedUpEscrows = result.events.map(parseEscrowEvent);
    setEscrows((current) => mergeDirectoryItems(current, lookedUpEscrows));
    setEscrowDirectoryLog(result.results.map((item) => `${item.relay}: ${item.ok ? "OK" : "failed"} - ${item.message}`));
    setEscrowDirectoryState(result.results.some((item) => item.ok) || result.events.length > 0 ? "loaded" : "failed");
  }

  function applyEscrowSnapshot(snapshot: DirectorySnapshot) {
    setEscrows(snapshot.events.map(parseEscrowEvent));
    setEscrowDirectoryLog(snapshot.results.map((item) => `${item.relay}: ${item.ok ? "OK" : "failed"} - ${item.message}`));
  }

  async function loginWithNip07() {
    setAuthStatus("connecting");
    setAuthMessage("");

    try {
      if (!window.nostr?.getPublicKey || !window.nostr.signEvent) {
        setAuthStatus("failed");
        setAuthMessage("Install or enable a NIP-07 browser signer to log in.");
        return;
      }

      const extensionPubkey = await window.nostr.getPublicKey();
      const challenge = `pontmore-login-${Date.now()}`;
      const signed = await window.nostr.signEvent({
        kind: 22242,
        pubkey: extensionPubkey,
        created_at: Math.floor(Date.now() / 1000),
        tags: [["challenge", challenge]],
        content: "Log in to Pontmore proof of concept",
      });

      if (signed.pubkey !== extensionPubkey) {
        setAuthStatus("failed");
        setAuthMessage("The signer returned a different Nostr identity.");
        return;
      }

      setAuthSession({ type: "nip07", pubkey: extensionPubkey });
      setAuthStatus("idle");
      setActiveTab("discover");
      setPublishState("idle");
      setPublishLog([]);
      setEscrowPublishState("idle");
      setEscrowPublishLog([]);
      void loadProfileForIdentity(extensionPubkey);
      void loadAgentDefinitionForIdentity(extensionPubkey);
      void loadEscrowDefinitionForIdentity(extensionPubkey);
    } catch {
      setAuthStatus("failed");
      setAuthMessage("NIP-07 login was cancelled or failed.");
    }
  }

  function createLocalIdentity() {
    setAuthStatus("creating");
    setAuthMessage("");
    const generated = generateSecretKey();
    const generatedPubkey = getPublicKey(generated);
    window.localStorage.setItem(SECRET_KEY_STORAGE, bytesToHex(generated));
    setAuthSession({ type: "local", pubkey: generatedPubkey, secretKey: generated });
    setAuthStatus("idle");
    setActiveTab("discover");
    setPublishState("idle");
    setPublishLog([]);
    setEscrowPublishState("idle");
    setEscrowPublishLog([]);
    void loadProfileForIdentity(generatedPubkey);
    void loadAgentDefinitionForIdentity(generatedPubkey);
    void loadEscrowDefinitionForIdentity(generatedPubkey);
  }

  function generateFreshAgentIdentity() {
    const generated = generateSecretKey();
    window.localStorage.setItem(AGENT_SECRET_KEY_STORAGE, bytesToHex(generated));
    setAgentSecretKey(generated);
    setPublishState("idle");
    setPublishLog([]);
    void loadAgentDefinitionForIdentity(getPublicKey(generated));
  }

  function useLoginIdentityForAgent() {
    window.localStorage.removeItem(AGENT_SECRET_KEY_STORAGE);
    setAgentSecretKey(null);
    setPublishState("idle");
    setPublishLog([]);
    if (sessionPubkey) {
      void loadAgentDefinitionForIdentity(sessionPubkey);
    }
  }

  function generateFreshEscrowIdentity() {
    const generated = generateSecretKey();
    window.localStorage.setItem(ESCROW_SECRET_KEY_STORAGE, bytesToHex(generated));
    setEscrowSecretKey(generated);
    setEscrowPublishState("idle");
    setEscrowPublishLog([]);
    void loadEscrowDefinitionForIdentity(getPublicKey(generated));
  }

  function useLoginIdentityForEscrow() {
    window.localStorage.removeItem(ESCROW_SECRET_KEY_STORAGE);
    setEscrowSecretKey(null);
    setEscrowPublishState("idle");
    setEscrowPublishLog([]);
    if (sessionPubkey) {
      void loadEscrowDefinitionForIdentity(sessionPubkey);
    }
  }

  function logout() {
    setAuthSession(null);
    setActiveTab("discover");
    setAuthStatus("idle");
    setAuthMessage("");
  }

  async function loadAgentDefinitionForIdentity(identityPubkey: string) {
    const snapshot = await lookupDefinition(`/api/agents/lookup`, `${PIP00_AGENT_KIND}:${identityPubkey}:agent`);
    if (!snapshot) {
      return;
    }

    applyAgentSnapshot(snapshot);
    const definition = snapshot.events
      .map(parseAgentEvent)
      .find((agent) => agent.event.pubkey === identityPubkey && agent.identifier === "agent" && agent.content);

    if (definition) {
      prefillAgentForm(definition);
    }
  }

  async function loadEscrowDefinitionForIdentity(identityPubkey: string) {
    const snapshot = await lookupDefinition(`/api/escrows/lookup`, `${PIP01_ESCROW_KIND}:${identityPubkey}:escrow`);
    if (!snapshot) {
      return;
    }

    applyEscrowSnapshot(snapshot);
    const definition = snapshot.events
      .map(parseEscrowEvent)
      .find((escrow) => escrow.event.pubkey === identityPubkey && escrow.identifier === "escrow" && escrow.content);

    if (definition) {
      prefillEscrowForm(definition);
    }
  }

  async function loadEscrowDefinitionForCoordinate(coordinateValue: string) {
    const snapshot = await lookupDefinition(`/api/escrows/lookup`, coordinateValue);
    if (!snapshot) {
      return;
    }

    const definitions = snapshot.events.map(parseEscrowEvent);
    setEscrows((current) => mergeDirectoryItems(current, definitions));

    const definition = definitions.find((escrow) => (
      matchesLookup(escrow.event.kind, escrow.event.pubkey, escrow.identifier, coordinateValue) && escrow.content
    ));

    if (definition) {
      prefillEscrowForm(definition);
    }
  }

  async function lookupDefinition(endpoint: string, coordinateValue: string): Promise<DirectorySnapshot | null> {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ relays, coordinate: coordinateValue }),
      });

      if (!response.ok) {
        return null;
      }

      return await response.json() as DirectorySnapshot;
    } catch {
      return null;
    }
  }

  function prefillAgentForm(agent: AgentDefinition) {
    const content = agent.content;
    if (!content) {
      return;
    }

    setCapabilities(content.capabilities.join(", "));
    setEscrowAddress(agent.escrowAddress);
  }

  function prefillEscrowForm(escrow: EscrowDescriptor) {
    const content = escrow.content;
    if (!content) return;
    setEscrowType(content.escrow_type);
    setEscrowNetworks(content.networks);
    setExpiresAt(String(content.expires_at));
    setSchemaType(content.service?.schema.type || "openapi");
    setSchemaUrl(content.service?.schema.url || "");
  }

  function saveSettings() {
    const parsed = parseRelayInput(relayInput);
    if (parsed.length === 0) {
      setSettingsState("failed");
      return;
    }

    setRelays(parsed);
    setRelayInput(parsed.join("\n"));
    window.localStorage.setItem(RELAYS_STORAGE, parsed.join("\n"));
    setSettingsState("saved");
    window.setTimeout(() => setSettingsState("idle"), 1800);
  }

  function resetSettings() {
    const defaults = [...DEFAULT_RELAYS];
    setRelays(defaults);
    setRelayInput(defaults.join("\n"));
    window.localStorage.removeItem(RELAYS_STORAGE);
    setSettingsState("saved");
    window.setTimeout(() => setSettingsState("idle"), 1800);
  }

  function clearAgentFilters() {
    setCoordinate("");
    setAgentLookupFilter("");
    setCapabilityFilter("");
    setEscrowFilter("");
  }

  function clearEscrowFilters() {
    setEscrowCoordinateInput("");
    setEscrowLookupFilter("");
    setEscrowTypeFilter("");
    setEscrowNetworkFilter("");
    setEscrowSchemaTypeFilter("");
  }

  function editAgentFromListing(agent: AgentDefinition) {
    prefillAgentForm(agent);
    setActiveTab("publish");
  }

  function selectTab(value: ActiveTab) {
    setActiveTab(value);
    setMobileNavOpen(false);
  }

  if (!authSession) {
    return (
      <LandingPage
        status={authStatus}
        message={authMessage}
        onLogin={loginWithNip07}
        onCreateIdentity={createLocalIdentity}
      />
    );
  }

  const relayFooter = activeTab === "discover"
    ? {
        title: "Agent relay reads",
        lines: directoryLog,
        severity: directoryState === "failed" ? "error" as const : "info" as const,
      }
    : activeTab === "escrow-discover"
      ? {
          title: "Escrow relay reads",
          lines: escrowDirectoryLog,
          severity: escrowDirectoryState === "failed" ? "error" as const : "info" as const,
        }
      : null;

  return (
    <Box sx={{ minHeight: "100vh" }}>
      <AppBar
        position="fixed"
        color="inherit"
        elevation={0}
        sx={{
          borderBottom: 1,
          borderColor: "divider",
          zIndex: (theme) => theme.zIndex.drawer + 1,
        }}
      >
        <Toolbar disableGutters>
          <IconButton edge="start" aria-label="Open navigation" onClick={() => setMobileNavOpen(true)} sx={{ display: { md: "none" }, mr: 1 }}>
            <MenuIcon />
          </IconButton>
          <Box sx={{ alignItems: "center", display: { xs: "none", md: "flex" }, gap: 1.25, height: "100%", px: 3, width: DRAWER_WIDTH }}>
            <BrandLogo />
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="h6" component="div" sx={{ fontWeight: 900, letterSpacing: 0 }}>
                PONTMORE
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", lineHeight: 1.1 }}>
                proof of concept
              </Typography>
            </Box>
          </Box>
          <Divider orientation="vertical" flexItem sx={{ display: { xs: "none", md: "block" } }} />
          <TopBarPageLabel title={pageTitle} pipLink={pagePipLink} meta={pageMeta} action={topBarAction} />
        </Toolbar>
      </AppBar>

      <Drawer
        variant="permanent"
        sx={{
          display: { xs: "none", md: "block" },
          width: DRAWER_WIDTH,
          flexShrink: 0,
          "& .MuiDrawer-paper": {
            width: DRAWER_WIDTH,
            boxSizing: "border-box",
            top: 64,
            height: "calc(100% - 64px)",
          },
        }}
      >
        <DashboardNav activeTab={activeTab} session={authSession} onSelect={selectTab} onProfile={() => selectTab("profile")} onLogout={logout} />
      </Drawer>

      <Drawer
        variant="temporary"
        open={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
        ModalProps={{ keepMounted: true }}
        sx={{
          display: { xs: "block", md: "none" },
          "& .MuiDrawer-paper": {
            width: DRAWER_WIDTH,
            boxSizing: "border-box",
          },
        }}
      >
        <DashboardNav activeTab={activeTab} session={authSession} onSelect={selectTab} onProfile={() => selectTab("profile")} onLogout={logout} />
      </Drawer>

      <Box
        component="main"
        sx={{
          display: "flex",
          flexDirection: "column",
          minHeight: "100vh",
          pl: { md: `${DRAWER_WIDTH}px` },
          pt: 7,
        }}
      >
        <Stack spacing={2.5} sx={{ flex: 1, p: { xs: 2, md: 3 }, maxWidth: "none" }}>
        {activeTab === "publish" ? (
          <Box sx={{ display: "grid", gap: 2.5, gridTemplateColumns: { xs: "1fr", md: "320px 1fr" }, alignItems: "start" }}>
            <IdentityPanel
              title="Agent Identity"
              note={agentSecretKey ? "Agent events are signed by a locally generated agent identity." : "Agent events default to the logged-in Nostr identity."}
              npub={npub}
              pubkey={pubkey}
              method={agentSecretKey ? "local" : authSession.type}
              actionLabel="Create Agent Identity"
              onAction={generateFreshAgentIdentity}
              secondaryActionLabel={agentSecretKey ? "Use Login Identity" : undefined}
              onSecondaryAction={agentSecretKey ? useLoginIdentityForAgent : undefined}
            />

            <Card variant="outlined">
              <CardContent>
                <Stack spacing={2}>
                  <Stack direction="row" spacing={2} sx={{ alignItems: "center", justifyContent: "space-between" }}>
                    <Typography variant="h5" component="h2" sx={{ fontWeight: 800 }}>Agent Definition</Typography>
                    <Chip label={`d: ${AGENT_D_TAG}`} variant="outlined" />
                  </Stack>

                  <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", md: "repeat(2, minmax(0, 1fr))" } }}>
                    <TextField label="Versioned capabilities" value={capabilities} onChange={(event) => setCapabilities(event.target.value)} helperText="Comma-separated identifiers, such as pontmore/swap@1" sx={{ gridColumn: "1 / -1" }} />
                    <Alert severity="info" sx={{ gridColumn: "1 / -1" }}>Publish names and descriptions from Profile. Commercial terms belong in signed, expiring offers or quotes.</Alert>
                    <Autocomplete
                      freeSolo
                      options={escrowAddressOptions}
                      getOptionLabel={(option) => (typeof option === "string" ? option : option.label)}
                      inputValue={escrowAddress}
                      onInputChange={(_, value) => setEscrowAddress(value)}
                      onChange={(_, option) => {
                        if (typeof option === "string") {
                          setEscrowAddress(option);
                          return;
                        }

                        setEscrowAddress(option?.value ?? "");
                      }}
                      renderInput={(params) => (
                        <TextField
                          {...params}
                          label="Escrow descriptor address (optional)"
                          placeholder={effectiveEscrowAddress}
                        />
                      )}
                      sx={{ gridColumn: "1 / -1" }}
                    />

                  </Box>

                  {publishLog.length > 0 ? <StatusLog title="Publish results" lines={publishLog} severity={publishState === "failed" ? "error" : "info"} /> : null}
                  <Stack direction="row" sx={{ justifyContent: "flex-end" }}>
                    <Button variant="contained" onClick={publishAgent} disabled={!authSession || publishState === "publishing"}>
                      {publishState === "publishing" ? "Publishing..." : "Publish Agent"}
                    </Button>
                  </Stack>
                </Stack>
              </CardContent>
            </Card>
          </Box>
        ) : null}

        {activeTab === "escrow-publish" ? (
          <Box sx={{ display: "grid", gap: 2.5, gridTemplateColumns: { xs: "1fr", md: "320px 1fr" }, alignItems: "start" }}>
            <IdentityPanel
              title="Escrow Identity"
              note={escrowSecretKey ? "Escrow events are signed by a locally generated escrow identity." : "Escrow events default to the logged-in Nostr identity."}
              npub={escrowNpub}
              pubkey={escrowPubkey}
              method={escrowSecretKey ? "local" : authSession.type}
              actionLabel="Create Escrow Identity"
              onAction={generateFreshEscrowIdentity}
              secondaryActionLabel={escrowSecretKey ? "Use Login Identity" : undefined}
              onSecondaryAction={escrowSecretKey ? useLoginIdentityForEscrow : undefined}
            />

            <Card variant="outlined">
              <CardContent>
                <Stack spacing={2}>
                  <Stack direction="row" spacing={2} sx={{ alignItems: "center", justifyContent: "space-between" }}>
                    <Typography variant="h5" component="h2" sx={{ fontWeight: 800 }}>Escrow Descriptor</Typography>
                    <Chip label={`d: ${ESCROW_D_TAG}`} variant="outlined" />
                  </Stack>

                  <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", md: "repeat(2, minmax(0, 1fr))" } }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 800, gridColumn: "1 / -1" }}>Descriptor</Typography>
                    <TextField label="Escrow type" select value={escrowType} onChange={(event) => setEscrowType(event.target.value)}>
                      {ESCROW_TYPE_OPTIONS.map((option) => (
                        <MenuItem value={option.value} key={option.value}>{option.label}</MenuItem>
                      ))}
                    </TextField>
                    <FormControl>
                      <InputLabel id="escrow-networks-label">Networks</InputLabel>
                      <Select
                        labelId="escrow-networks-label"
                        multiple
                        value={escrowNetworks}
                        onChange={(event) => setEscrowNetworks(isLightningHoldEscrow ? [Network.Lightning] : isCashuEscrow ? [Network.Cashu] : selectedMuiValues(event))}
                        input={<OutlinedInput label="Networks" />}
                        renderValue={(selected) => renderSelectedChips(selected, escrowNetworkOptions.map((network) => ({ value: network, label: formatProtocolValue(network) })))}
                      >
                        {escrowNetworkOptions.map((network) => (
                          <MenuItem value={network} key={network}>{formatProtocolValue(network)}</MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                    <TextField label="Expires at (Unix seconds)" type="number" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} helperText="An expired replacement withdraws the descriptor from new coordinations." />
                    <TextField label="Service schema type" select value={schemaType} onChange={(event) => setSchemaType(event.target.value as "openapi" | "asyncapi")}>
                      <MenuItem value="openapi">OpenAPI</MenuItem>
                      <MenuItem value="asyncapi">AsyncAPI</MenuItem>
                    </TextField>
                    <TextField label="Service schema URL (optional)" value={schemaUrl} onChange={(event) => setSchemaUrl(event.target.value)} helperText="Absolute HTTPS URL to a versioned schema artifact." sx={{ gridColumn: "1 / -1" }} />
                    <Alert severity="info" sx={{ gridColumn: "1 / -1" }}>Service operations, funding, release, refunds, disputes, fees, and recovery belong in the referenced schema. This POC does not fetch or validate schema artifacts.</Alert>
                  </Box>

                  {escrowPublishLog.length > 0 ? <StatusLog title="Publish results" lines={escrowPublishLog} severity={escrowPublishState === "failed" ? "error" : "info"} /> : null}
                  <Stack direction="row" sx={{ justifyContent: "flex-end" }}>
                    <Button variant="contained" onClick={publishEscrow} disabled={!authSession || escrowPublishState === "publishing"}>
                      {escrowPublishState === "publishing" ? "Publishing..." : "Publish Escrow Descriptor"}
                    </Button>
                  </Stack>
                </Stack>
              </CardContent>
            </Card>
          </Box>
        ) : null}

        {activeTab === "profile" ? (
          <Box sx={{ display: "grid", gap: 2.5, gridTemplateColumns: { xs: "1fr", md: "320px 1fr" }, alignItems: "start" }}>
            <NostrProfileCard session={authSession} onProfile={() => undefined} onLogout={logout} expanded />

            <Card variant="outlined">
              <CardContent>
                <Stack spacing={2}>
                  <Stack direction="row" spacing={2} sx={{ alignItems: "center", justifyContent: "space-between" }}>
                    <Box>
                      <Typography variant="h5" component="h2" sx={{ fontWeight: 800 }}>Profile Management</Typography>
                      <Typography color="text.secondary" variant="body2" sx={{ mt: 0.5 }}>
                        Publishes a NIP-01 kind 0 metadata event to your configured relays.
                      </Typography>
                    </Box>
                    <Chip label="kind: 0" variant="outlined" />
                  </Stack>

                  <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", md: "repeat(2, minmax(0, 1fr))" } }}>
                    <TextField label="Name" value={profileName} onChange={(event) => setProfileName(event.target.value)} />
                    <TextField label="Display name" value={profileDisplayName} onChange={(event) => setProfileDisplayName(event.target.value)} />
                    <TextField label="About" value={profileAbout} onChange={(event) => setProfileAbout(event.target.value)} multiline minRows={4} sx={{ gridColumn: "1 / -1" }} />
                    <TextField label="Picture URL" value={profilePicture} onChange={(event) => setProfilePicture(event.target.value)} sx={{ gridColumn: "1 / -1" }} />
                    <TextField label="Banner URL" value={profileBanner} onChange={(event) => setProfileBanner(event.target.value)} sx={{ gridColumn: "1 / -1" }} />
                    <TextField label="Website" value={profileWebsite} onChange={(event) => setProfileWebsite(event.target.value)} />
                    <TextField label="NIP-05 identifier" value={profileNip05} onChange={(event) => setProfileNip05(event.target.value)} placeholder="name@example.com" />
                    <TextField label="Lightning address" value={profileLud16} onChange={(event) => setProfileLud16(event.target.value)} placeholder="name@example.com" />
                  </Box>

                  {profileLog.length > 0 ? <StatusLog title="Profile publish results" lines={profileLog} severity={profileState === "failed" ? "error" : "info"} /> : null}
                  <Stack direction="row" spacing={1.5} sx={{ justifyContent: "flex-end" }}>
                    <Button variant="outlined" onClick={() => loadProfileForIdentity(sessionPubkey)} disabled={profileState === "publishing"}>Reload profile</Button>
                    <Button variant="contained" onClick={publishProfile} disabled={profileState === "publishing"}>
                      {profileState === "publishing" ? "Publishing..." : "Publish profile"}
                    </Button>
                  </Stack>
                </Stack>
              </CardContent>
            </Card>
          </Box>
        ) : null}

        {activeTab === "discover" ? (
          <Stack spacing={2}>
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ alignItems: { xs: "stretch", sm: "center" } }}>
                <TextField
                  fullWidth
                  label="Pubkey or coordinate"
                  value={coordinate}
                  placeholder="<pubkey> or 30360:<pubkey>:agent"
                  onChange={(event) => {
                    setCoordinate(event.target.value);
                    if (!event.target.value.trim()) {
                      setAgentLookupFilter("");
                    }
                  }}
                />
                <SearchActionButton
                  label="Search agents"
                  loading={directoryState === "loading"}
                  onClick={lookupCoordinate}
                />
                <FilterMenu
                  label="Agent filters"
                  activeCount={activeFilterCount}
                  fields={[
                    { label: "Capability", value: capabilityFilter, options: filterOptions.capabilities, onChange: setCapabilityFilter, formatOption: formatProtocolValue },
                    { label: "Selected escrow", value: escrowFilter, options: filterOptions.escrows, onChange: setEscrowFilter },
                  ]}
                  onClear={clearAgentFilters}
                />
              </Stack>
            </Paper>

            <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", md: "repeat(3, minmax(0, 1fr))" } }}>
              {filteredAgents.map((agent) => (
                <AgentCard
                  agent={agent}
                  activeAgentPubkey={pubkey}
                  onEdit={editAgentFromListing}
                  key={agent.event.id}
                />
              ))}
            </Box>
          </Stack>
        ) : null}

        {activeTab === "escrow-discover" ? (
          <Stack spacing={2}>
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ alignItems: { xs: "stretch", sm: "center" } }}>
                <TextField
                  fullWidth
                  label="Pubkey or coordinate"
                  value={escrowCoordinateInput}
                  placeholder="<pubkey> or 30361:<pubkey>:escrow"
                  onChange={(event) => {
                    setEscrowCoordinateInput(event.target.value);
                    if (!event.target.value.trim()) {
                      setEscrowLookupFilter("");
                    }
                  }}
                />
                <SearchActionButton
                  label="Search escrows"
                  loading={escrowDirectoryState === "loading"}
                  onClick={lookupEscrowCoordinate}
                />
                <FilterMenu
                  label="Escrow filters"
                  activeCount={activeEscrowFilterCount}
                  fields={[
                    { label: "Escrow type", value: escrowTypeFilter, options: escrowFilterOptions.types, onChange: setEscrowTypeFilter, formatOption: formatProtocolValue },
                    { label: "Network", value: escrowNetworkFilter, options: escrowFilterOptions.networks, onChange: setEscrowNetworkFilter, formatOption: formatProtocolValue },
                    { label: "Schema type", value: escrowSchemaTypeFilter, options: escrowFilterOptions.schemaTypes, onChange: setEscrowSchemaTypeFilter },
                  ]}
                  onClear={clearEscrowFilters}
                />
              </Stack>
            </Paper>

            <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", md: "repeat(3, minmax(0, 1fr))" } }}>
              {filteredEscrows.map((escrow) => (
                <EscrowCard escrow={escrow} key={escrow.event.id} />
              ))}
            </Box>
          </Stack>
        ) : null}

        {activeTab === "settings" ? (
          <Card variant="outlined" sx={{ width: "100%" }}>
            <CardContent>
              <Stack spacing={2}>
                <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ justifyContent: "space-between", alignItems: { xs: "stretch", sm: "center" } }}>
                  <Box>
                    <Typography variant="h5" component="h2" sx={{ fontWeight: 800 }}>Relay Defaults</Typography>
                  </Box>
                  <Stack direction="row" spacing={1}>
                    <Button variant="outlined" onClick={resetSettings}>Reset</Button>
                    <Button variant="contained" onClick={saveSettings}>{settingsState === "saved" ? "Saved" : "Save"}</Button>
                  </Stack>
                </Stack>

                <TextField
                  label="Default relays"
                  value={relayInput}
                  onChange={(event) => {
                    setRelayInput(event.target.value);
                    setSettingsState("idle");
                  }}
                  multiline
                  minRows={5}
                />
                {settingsState === "failed" ? <Alert severity="error">Enter at least one relay URL.</Alert> : null}
                <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
                  {relays.map((relay) => (
                    <Chip label={relay} key={relay} variant="outlined" />
                  ))}
                </Stack>
              </Stack>
            </CardContent>
          </Card>
        ) : null}
        </Stack>
        <PageFooter relay={relayFooter} />
      </Box>
    </Box>
  );
}

function TopBarPageLabel({
  title,
  pipLink,
  meta,
  action,
}: {
  title: string;
  pipLink?: { href: string; label: string };
  meta: string | null;
  action: ReactNode;
}) {
  return (
    <Stack
      direction="row"
      spacing={1.5}
      sx={{
        alignItems: "center",
        flex: 1,
        minWidth: 0,
        px: { xs: 1.5, md: 3 },
      }}
    >
      <Stack direction="row" spacing={1.25} sx={{ alignItems: "baseline", flex: 1, minWidth: 0 }}>
        <Typography variant="h6" component="h1" noWrap sx={{ fontWeight: 800 }}>
          {title}
        </Typography>
        {pipLink ? (
          <Link
            href={pipLink.href}
            target="_blank"
            rel="noreferrer"
            underline="hover"
            sx={{ fontSize: 14, fontWeight: 700 }}
          >
            {pipLink.label}
          </Link>
        ) : null}
      </Stack>
      {meta ? <Chip label={meta} size="small" variant="outlined" sx={{ display: { xs: "none", sm: "inline-flex" } }} /> : null}
      {action ? (
        <Box sx={{ display: { xs: "none", md: "block" }, flexShrink: 0 }}>
          {action}
        </Box>
      ) : null}
    </Stack>
  );
}

function PageFooter({ relay }: { relay: RelayFooterConfig | null }) {
  if (!relay) {
    return null;
  }

  return (
    <Box
      component="footer"
      sx={{
        borderTop: 1,
        borderColor: "divider",
        minHeight: 72,
        px: { xs: 2, md: 3 },
        py: 1.5,
      }}
    >
      {relay.lines.length > 0 ? (
        <StatusLog title={relay.title} lines={relay.lines} severity={relay.severity} compact />
      ) : (
        <Typography variant="body2" color="text.secondary">
          Relay reads appear here after refreshing or looking up discovery events.
        </Typography>
      )}
    </Box>
  );
}

function BrandLogo() {
  return (
    <Box
      component="img"
      src={LOGO_SRC}
      alt=""
      aria-hidden="true"
      sx={{
        borderRadius: 1,
        flex: "0 0 auto",
        height: 36,
        objectFit: "contain",
        width: 36,
      }}
    />
  );
}

function LandingPage({
  status,
  message,
  onLogin,
  onCreateIdentity,
}: {
  status: AuthStatus;
  message: string;
  onLogin: () => void;
  onCreateIdentity: () => void;
}) {
  return (
    <Box sx={{ minHeight: "100vh", display: "grid", gridTemplateColumns: { xs: "1fr", md: "0.9fr 1.1fr" } }}>
      <Box sx={{ alignItems: "center", borderRight: { md: 1 }, borderColor: "divider", display: "flex", p: { xs: 3, md: 6 } }}>
        <Stack spacing={4} sx={{ maxWidth: 560 }}>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
            <BrandLogo />
            <Box>
              <Typography variant="h5" sx={{ fontWeight: 900, letterSpacing: 0 }}>PONTMORE</Typography>
              <Typography color="text.secondary">proof of concept</Typography>
            </Box>
          </Stack>
          <Box>
            <Typography variant="h2" component="h1" sx={{ fontSize: { xs: 42, md: 58 }, fontWeight: 900, letterSpacing: 0, lineHeight: 1 }}>
              Discover agents and escrow descriptors on Nostr.
            </Typography>
            <Typography color="text.secondary" sx={{ fontSize: 18, mt: 2 }}>
              Pontmore defines capability discovery, escrow compatibility, and experimental coordination event chains.
            </Typography>
          </Box>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
            <Button variant="contained" size="large" onClick={onLogin} disabled={status === "connecting" || status === "creating"}>
              {status === "connecting" ? "Signing..." : "LOG IN"}
            </Button>
            <Button color="secondary" variant="outlined" size="large" onClick={onCreateIdentity} disabled={status === "connecting" || status === "creating"}>
              {status === "creating" ? "Creating..." : "SIGN UP"}
            </Button>
          </Stack>
          {message ? <Alert severity={status === "failed" ? "error" : "info"}>{message}</Alert> : null}
        </Stack>
      </Box>
      <Box sx={{ alignItems: "center", display: "flex", p: { xs: 3, md: 6 } }}>
        <Stack spacing={2} sx={{ width: "100%" }}>
          {[
            ["PIP-00", "Publish versioned capability indexes and optional escrow references."],
            ["PIP-01", "Publish escrow compatibility, expiry, and optional service-schema references."],
            ["Nostr-first", "Log in with a NIP-07 signer or create a new browser-local proof-of-concept identity."],
          ].map(([title, body]) => (
            <Card
              variant="outlined"
              key={title}
              sx={{
                borderColor: "rgba(240, 140, 0, 0.35)",
                borderLeft: 4,
                borderLeftColor: "secondary.main",
                transition: "border-color 160ms ease, background-color 160ms ease",
                "&:hover": {
                  bgcolor: "rgba(240, 140, 0, 0.05)",
                  borderColor: "secondary.main",
                },
              }}
            >
              <CardContent>
                <Typography variant="h6" sx={{ color: "secondary.dark", fontWeight: 800 }}>{title}</Typography>
                <Typography color="text.secondary" sx={{ mt: 1 }}>{body}</Typography>
              </CardContent>
            </Card>
          ))}
        </Stack>
      </Box>
    </Box>
  );
}

function DashboardNav({
  activeTab,
  session,
  onSelect,
  onProfile,
  onLogout,
}: {
  activeTab: ActiveTab;
  session: AuthSession;
  onSelect: (value: ActiveTab) => void;
  onProfile: () => void;
  onLogout: () => void;
}) {
  return (
    <Stack sx={{ height: "100%" }}>
      <Box sx={{ alignItems: "center", display: { md: "none" }, gap: 1.25, p: 2.5 }}>
        <BrandLogo />
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h6" sx={{ fontWeight: 900, lineHeight: 1.1, letterSpacing: 0 }}>
            PONTMORE
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
            proof of concept
          </Typography>
        </Box>
      </Box>
      <Divider />
      <List component="nav" aria-label="Pontmore POC sections" sx={{ p: 1 }}>
        {NAV_ITEMS.map((item) => (
          <ListItemButton
            selected={activeTab === item.value}
            onClick={() => onSelect(item.value)}
            key={item.value}
            sx={{ borderRadius: 1 }}
          >
            <ListItemText primary={item.label} />
          </ListItemButton>
        ))}
      </List>
      <Box sx={{ mt: "auto", p: 1.5 }}>
        <NostrProfileCard session={session} onProfile={onProfile} onLogout={onLogout} />
      </Box>
    </Stack>
  );
}

function NostrProfileCard({
  session,
  onProfile,
  onLogout,
  expanded = false,
}: {
  session: AuthSession;
  onProfile: () => void;
  onLogout: () => void;
  expanded?: boolean;
}) {
  const npub = nip19.npubEncode(session.pubkey);

  return (
    <Paper variant="outlined" sx={{ p: 1.5 }}>
      <Stack spacing={1}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <Box sx={{ bgcolor: "primary.main", borderRadius: 1, height: 34, width: 34 }} />
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="subtitle2" noWrap sx={{ fontWeight: 800 }}>Nostr profile</Typography>
            <Typography variant="caption" color="text.secondary">
              {session.type === "nip07" ? "NIP-07 signer" : "Local identity"}
            </Typography>
          </Box>
        </Stack>
        <Typography variant="caption" sx={{ display: "block", fontFamily: "monospace", overflowWrap: "anywhere" }}>
          {npub}
        </Typography>
        {expanded ? <Detail label="Pubkey">{session.pubkey}</Detail> : null}
        <Stack direction={expanded ? "row" : "column"} spacing={1}>
          {!expanded ? <Button variant="outlined" size="small" onClick={onProfile}>See details</Button> : null}
          <Button variant="outlined" size="small" onClick={onLogout}>Sign out</Button>
        </Stack>
      </Stack>
    </Paper>
  );
}

function StatusLog({ title, lines, severity = "info", compact = false }: { title: string; lines: string[]; severity?: "info" | "error"; compact?: boolean }) {
  if (compact) {
    return (
      <Alert severity={severity} sx={{ py: 0.75 }}>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={{ xs: 0.5, sm: 2 }} sx={{ alignItems: { xs: "flex-start", sm: "center" } }}>
          <Typography sx={{ fontWeight: 800, whiteSpace: "nowrap" }}>{title}</Typography>
          {lines.map((line) => (
            <Typography variant="body2" sx={{ overflowWrap: "anywhere" }} key={line}>{line}</Typography>
          ))}
        </Stack>
      </Alert>
    );
  }

  return (
    <Alert severity={severity}>
      <Typography sx={{ mb: 0.5, fontWeight: 800 }}>{title}</Typography>
      <Stack spacing={0.25}>
        {lines.map((line) => (
          <Typography variant="body2" sx={{ overflowWrap: "anywhere" }} key={line}>{line}</Typography>
        ))}
      </Stack>
    </Alert>
  );
}

function IdentityPanel({
  title,
  note,
  npub,
  pubkey,
  method,
  actionLabel,
  onAction,
  secondaryActionLabel,
  onSecondaryAction,
}: {
  title: string;
  note: string;
  npub: string;
  pubkey: string;
  method: AuthSession["type"];
  actionLabel?: string;
  onAction?: () => void;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
}) {
  const [npubCopyState, setNpubCopyState] = useState<"idle" | "copied" | "failed">("idle");

  return (
    <Card variant="outlined" sx={{ position: { md: "sticky" }, top: { md: 20 } }}>
      <CardContent>
        <Stack spacing={2}>
          <Box>
            <Typography variant="h5" component="h2" sx={{ fontWeight: 800 }}>{title}</Typography>
            <Typography color="text.secondary" variant="body2" sx={{ mt: 1 }}>{note}</Typography>
          </Box>
          <Divider />
          <Stack spacing={1}>
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 800, textTransform: "uppercase" }}>Nostr public key</Typography>
            <Stack direction="row" spacing={1} sx={{ alignItems: "stretch" }}>
              <Paper variant="outlined" sx={{ p: 1, flex: 1, bgcolor: "action.hover", overflowWrap: "anywhere", fontFamily: "monospace", fontSize: 12 }}>
                {npub || "Not signed in"}
              </Paper>
              <Button variant="outlined" onClick={() => copyIdentityValue(npub, setNpubCopyState)} disabled={!npub}>
                {npubCopyState === "copied" ? "Copied" : "Copy"}
              </Button>
            </Stack>
            {npubCopyState === "failed" ? <Alert severity="error">Clipboard write failed.</Alert> : null}
          </Stack>
          <Detail label="Signing method">{method === "nip07" ? "NIP-07 browser signer" : "Locally created identity"}</Detail>
          <Detail label="Pubkey">{pubkey ? `${pubkey.slice(0, 18)}...${pubkey.slice(-8)}` : "None"}</Detail>
          <Stack spacing={1}>
            {actionLabel && onAction ? <Button variant="outlined" onClick={onAction}>{actionLabel}</Button> : null}
            {secondaryActionLabel && onSecondaryAction ? <Button variant="outlined" onClick={onSecondaryAction}>{secondaryActionLabel}</Button> : null}
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
  formatOption = (option) => option,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
  formatOption?: (option: string) => string;
}) {
  return (
    <TextField label={label} select value={value} onChange={(event) => onChange(event.target.value)} fullWidth>
      <MenuItem value="">All</MenuItem>
      {options.map((option) => (
        <MenuItem value={option} key={option}>{formatOption(option)}</MenuItem>
      ))}
    </TextField>
  );
}

function SearchActionButton({
  label,
  loading,
  onClick,
}: {
  label: string;
  loading: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip title={loading ? "Searching" : "Search"}>
      <Box component="span" sx={{ display: "inline-flex", width: { xs: "100%", sm: "auto" } }}>
        <IconButton
          color="primary"
          onClick={onClick}
          disabled={loading}
          aria-label={label}
          sx={{
            bgcolor: "primary.main",
            borderRadius: 1,
            color: "primary.contrastText",
            height: 48,
            width: { xs: "100%", sm: 56 },
            "&:hover": { bgcolor: "primary.dark" },
            "&.Mui-disabled": { bgcolor: "action.disabledBackground" },
          }}
        >
          <SearchIcon />
        </IconButton>
      </Box>
    </Tooltip>
  );
}

function FilterMenu({
  label,
  activeCount,
  fields,
  onClear,
}: {
  label: string;
  activeCount: number;
  fields: FilterField[];
  onClear: () => void;
}) {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const open = Boolean(anchorEl);

  return (
    <>
      <Button
        variant="outlined"
        startIcon={<FilterListIcon />}
        endIcon={activeCount > 0 ? <Chip label={activeCount} size="small" color="primary" sx={{ height: 22, minWidth: 22 }} /> : null}
        onClick={(event) => setAnchorEl(event.currentTarget)}
        aria-haspopup="menu"
        aria-expanded={open ? "true" : undefined}
        sx={{ justifyContent: "center", minWidth: 150 }}
      >
        Filters
      </Button>
      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={() => setAnchorEl(null)}
        slotProps={{
          paper: {
            sx: {
              mt: 1,
              width: { xs: "calc(100vw - 32px)", sm: 380 },
              maxWidth: "calc(100vw - 32px)",
              p: 2,
            },
          },
        }}
      >
        <Stack spacing={2}>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", justifyContent: "space-between" }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>{label}</Typography>
            <Button size="small" onClick={onClear} disabled={activeCount === 0}>Clear</Button>
          </Stack>
          {fields.map((field) => (
            <FilterSelect
              key={field.label}
              label={field.label}
              value={field.value}
              options={field.options}
              onChange={field.onChange}
              formatOption={field.formatOption}
            />
          ))}
        </Stack>
      </Menu>
    </>
  );
}

function AgentCard({
  agent,
  activeAgentPubkey,
  onEdit,
}: {
  agent: AgentDefinition;
  activeAgentPubkey: string;
  onEdit: (agent: AgentDefinition) => void;
}) {
  const canEdit = Boolean(activeAgentPubkey) && agent.event.pubkey === activeAgentPubkey && agent.identifier === "agent" && Boolean(agent.content);
  const [coordinateCopyState, setCoordinateCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [pubkeyCopyState, setPubkeyCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [definitionCopyState, setDefinitionCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [showJson, setShowJson] = useState(false);
  const coordinate = `${agent.event.kind}:${agent.event.pubkey}:${agent.identifier}`;
  const npub = nip19.npubEncode(agent.event.pubkey);
  const agentJson = JSON.stringify(
    {
      coordinate,
      npub,
      identifier: agent.identifier,
      content: agent.content,
      event: agent.event,
    },
    null,
    2,
  );

  return (
    <DirectoryDefinitionCard
      identifier={agent.identifier}
      createdAt={agent.event.created_at}
      json={agentJson}
      showJson={showJson}
      toggleLabel={showJson ? "Show agent summary" : "Show agent JSON"}
      onToggleJson={() => setShowJson((current) => !current)}
      copyState={definitionCopyState}
      onCopyDefinition={() => copyIdentityValue(agentJson, setDefinitionCopyState)}
      editAction={
        canEdit ? (
          <Button variant="outlined" size="small" onClick={() => onEdit(agent)}>
            Edit in Publishing
          </Button>
        ) : null
      }
    >
      <Box>
        <Typography variant="h6" component="h3" sx={{ fontWeight: 800 }}>
          {"Agent capability index"}
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 1 }}>
          {agent.validationErrors.join(" ") || "Signed capability declaration; availability and trust are separate application decisions."}
        </Typography>
      </Box>
      <CopyableDetail
        label="Coordinate"
        value={coordinate}
        copyState={coordinateCopyState}
        onCopy={() => copyIdentityValue(coordinate, setCoordinateCopyState)}
      />
      <CopyableDetail
        label="Pubkey"
        value={npub}
        copyState={pubkeyCopyState}
        onCopy={() => copyIdentityValue(npub, setPubkeyCopyState)}
      />
      <Detail label="Capabilities"><ValuePills values={agent.content?.capabilities} /></Detail>
      <Detail label="Selected escrow">{selectedEscrow(agent) || "None"}</Detail>
    </DirectoryDefinitionCard>
  );
}

function EscrowCard({ escrow }: { escrow: EscrowDescriptor }) {
  const [definitionCopyState, setDefinitionCopyState] = useState<"idle" | "copied" | "failed">("idle");
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
        minHeight: 300,
      }}
    >
      <CardContent sx={{ flexGrow: 1 }}>
        <Stack spacing={1.5}>
          <Typography variant="h6" component="h3" sx={{ fontWeight: 800 }}>
            {escrow.content?.escrow_type || escrow.escrowType || "Unnamed escrow"}
          </Typography>
          <Detail label="Coordinate">{coordinate}</Detail>
          <Detail label="Networks">
            <ValuePills values={escrow.content?.networks || escrow.networks} />
          </Detail>
          <Detail label="Created">{formatEventTime(escrow.event.created_at)}</Detail>
          {escrow.validationErrors.length ? <Alert severity="error">{escrow.validationErrors.join(" ")}</Alert> : null}
          <Detail label="Selection lifetime">{escrow.content ? `${escrow.content.expires_at <= Math.floor(Date.now() / 1000) ? "Expired" : "Valid until"} (${escrow.content.expires_at} Unix seconds)` : "Invalid descriptor"}</Detail>
          <Detail label="Service schema type">{escrow.content?.service?.schema.type || "No service interface"}</Detail>
          <Detail label="Service schema URL">{escrow.content?.service?.schema.url || "None"}</Detail>
        </Stack>
      </CardContent>
      <CardActions
        sx={{
          mt: "auto",
          px: 2,
          py: 1.5,
          borderTop: 1,
          borderColor: "divider",
          justifyContent: "space-between",
        }}
      >
        <Button variant="outlined" size="small" onClick={() => copyIdentityValue(escrowJson, setDefinitionCopyState)}>
          {definitionCopyState === "copied" ? "Copied" : "Copy definition"}
        </Button>
        <Button variant="outlined" size="small" href={`/escrow/${encodeURIComponent(coordinate)}`}>
          View details
        </Button>
      </CardActions>
      {definitionCopyState === "failed" ? <Alert severity="error" sx={{ mx: 2, mb: 2 }}>Clipboard write failed.</Alert> : null}
    </Card>
  );
}

function DirectoryDefinitionCard({
  accent = "green",
  identifier,
  createdAt,
  json,
  showJson,
  toggleLabel,
  onToggleJson,
  copyState,
  onCopyDefinition,
  editAction,
  children,
}: {
  accent?: "green" | "orange";
  identifier: string;
  createdAt: number;
  json: string;
  showJson: boolean;
  toggleLabel: string;
  onToggleJson: () => void;
  copyState: "idle" | "copied" | "failed";
  onCopyDefinition: () => void;
  editAction: React.ReactNode;
  children: React.ReactNode;
}) {
  const isOrange = accent === "orange";

  return (
    <Card
      variant="outlined"
      sx={{
        borderColor: isOrange ? "rgba(240, 140, 0, 0.35)" : "rgba(47, 158, 68, 0.35)",
        borderTop: 4,
        borderTopColor: isOrange ? "secondary.main" : "primary.main",
        height: { xs: "auto", md: 600 },
        display: "flex",
        flexDirection: "column",
      }}
    >
      <CardContent sx={{ flexGrow: 1, display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
        <Stack spacing={1.5} sx={{ flexGrow: 1, minHeight: 0 }}>
          <Stack direction="row" spacing={1} sx={{ justifyContent: "space-between", alignItems: "center", minWidth: 0 }}>
            <Chip
              label={identifier}
              size="small"
              color={isOrange ? "secondary" : "primary"}
              variant="outlined"
              sx={{ maxWidth: "100%", minWidth: 0, "& .MuiChip-label": { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }}
            />
            <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0, whiteSpace: "nowrap" }}>
              {formatEventTime(createdAt)}
            </Typography>
          </Stack>
          {showJson ? (
            <Paper
              variant="outlined"
              component="pre"
              sx={{
                m: 0,
                p: 1.5,
                flexGrow: 1,
                minHeight: 0,
                overflow: "auto",
                fontFamily: "monospace",
                fontSize: 12,
                whiteSpace: "pre-wrap",
                overflowWrap: "anywhere",
              }}
            >
              {json}
            </Paper>
          ) : (
            <Stack spacing={1.5} sx={{ flexGrow: 1, minHeight: 0, overflow: "auto", pr: 0.5 }}>
              {children}
            </Stack>
          )}
        </Stack>
      </CardContent>
      <DirectoryCardFooter
        showJson={showJson}
        toggleLabel={toggleLabel}
        onToggleJson={onToggleJson}
        copyState={copyState}
        onCopyDefinition={onCopyDefinition}
        editAction={editAction}
      />
    </Card>
  );
}

function DirectoryCardFooter({
  showJson,
  toggleLabel,
  onToggleJson,
  copyState,
  onCopyDefinition,
  editAction,
}: {
  showJson: boolean;
  toggleLabel: string;
  onToggleJson: () => void;
  copyState: "idle" | "copied" | "failed";
  onCopyDefinition: () => void;
  editAction: React.ReactNode;
}) {
  return (
    <>
      <CardActions
        sx={{
          mt: "auto",
          px: 2,
          py: 1.5,
          borderTop: 1,
          borderColor: "divider",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <Box>{editAction}</Box>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <Tooltip title={toggleLabel}>
            <IconButton
              size="small"
              color={showJson ? "primary" : "default"}
              aria-label={toggleLabel}
              onClick={onToggleJson}
            >
              <DataObjectIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Button variant="outlined" size="small" onClick={onCopyDefinition}>
            {copyState === "copied" ? "Copied" : "Copy definition"}
          </Button>
        </Stack>
      </CardActions>
      {copyState === "failed" ? <Alert severity="error" sx={{ mx: 2, mb: 2 }}>Clipboard write failed.</Alert> : null}
    </>
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

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 800, textTransform: "uppercase" }}>{label}</Typography>
      <Typography component="div" variant="body2" sx={{ overflowWrap: "anywhere" }}>{children}</Typography>
    </Box>
  );
}

async function copyIdentityValue(value: string, setState: (state: "idle" | "copied" | "failed") => void) {
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

function joinDisplayList(values: string[] | undefined): string {
  return values?.filter(Boolean).join(", ") || "";
}

function selectedEscrow(agent: AgentDefinition): string {
  return agent.escrowAddress;
}

function matchesFilter(values: string[] | undefined, filter: string): boolean {
  if (!filter) {
    return true;
  }

  return normalizeOptionList(values).includes(filter);
}

function matchesLookup(kind: number, pubkey: string, identifier: string, lookupValue: string): boolean {
  const parsed = parseLookupFilter(lookupValue);
  if (!parsed) {
    return true;
  }

  if (parsed.kind && parsed.kind !== kind) {
    return false;
  }

  if (parsed.identifier && parsed.identifier !== identifier) {
    return false;
  }

  return parsed.pubkey === pubkey;
}

function parseLookupFilter(value: string): { kind?: number; pubkey: string; identifier?: string } | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const coordinateParts = trimmed.split(":");
  if (coordinateParts.length >= 3) {
    const kind = Number(coordinateParts[0]);
    const pubkey = normalizePubkey(coordinateParts[1]);
    const identifier = coordinateParts.slice(2).join(":");

    if (Number.isFinite(kind) && pubkey && identifier) {
      return { kind, pubkey, identifier };
    }

    return { pubkey: "" };
  }

  const pubkey = normalizePubkey(trimmed);
  return pubkey ? { pubkey } : { pubkey: "" };
}

function normalizePubkey(value: string): string {
  const trimmed = value.trim();
  if (/^[0-9a-f]{64}$/i.test(trimmed)) {
    return trimmed.toLowerCase();
  }

  if (trimmed.startsWith("npub1")) {
    try {
      const decoded = nip19.decode(trimmed);
      return decoded.type === "npub" && typeof decoded.data === "string" ? decoded.data : "";
    } catch {
      return "";
    }
  }

  return "";
}

function mergeDirectoryItems<T extends { event: NostrEvent; identifier: string }>(current: T[], incoming: T[]): T[] {
  const byCoordinate = new Map<string, T>();

  for (const item of current) {
    byCoordinate.set(directoryItemKey(item), item);
  }

  for (const item of incoming) {
    const key = directoryItemKey(item);
    const previous = byCoordinate.get(key);
    if (!previous || item.event.created_at >= previous.event.created_at) {
      byCoordinate.set(key, item);
    }
  }

  return Array.from(byCoordinate.values()).sort((a, b) => b.event.created_at - a.event.created_at);
}

function directoryItemKey(item: { event: NostrEvent; identifier: string }): string {
  return `${item.event.kind}:${item.event.pubkey}:${item.identifier}`;
}

function buildFilterOptions(agents: AgentDefinition[]) {
  return {
    capabilities: uniqueSorted(agents.flatMap((agent) => normalizeOptionList(agent.content?.capabilities))),
    escrows: uniqueSorted(agents.map(selectedEscrow).filter(Boolean)),
  };
}

function buildEscrowFilterOptions(escrows: EscrowDescriptor[]) {
  return {
    types: uniqueSorted(escrows.map((escrow) => escrow.content?.escrow_type || escrow.escrowType).filter(Boolean)),
    networks: uniqueSorted(escrows.flatMap((escrow) => normalizeOptionList(escrow.content?.networks || escrow.networks))),
    schemaTypes: uniqueSorted(escrows.map((escrow) => escrow.content?.service?.schema.type || "").filter(Boolean)),
  };
}

function normalizeOptionList(values: string[] | undefined): string[] {
  return values?.map((value) => value.trim()).filter(Boolean) ?? [];
}

function removeEmptyProfileFields(profile: ProfileContent): ProfileContent {
  return Object.fromEntries(
    Object.entries(profile).filter(([, value]) => typeof value === "string" && value.trim().length > 0),
  ) as ProfileContent;
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

function uniqueByValue<T extends { value: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.value)) {
      return false;
    }

    seen.add(item.value);
    return true;
  });
}

function enumValues<T extends Record<string, string>>(items: T): T[keyof T][] {
  return Object.values(items) as T[keyof T][];
}

function enumOptions<T extends Record<string, string>>(items: T): { value: T[keyof T]; label: string }[] {
  return enumValues(items).map((value) => ({
    value,
    label: formatProtocolValue(value),
  }));
}

function selectedMuiValues(event: SelectChangeEvent<string[]>): string[] {
  const selected = event.target.value;
  return typeof selected === "string" ? selected.split(",") : selected;
}

function renderSelectedChips(selected: string[], options: { value: string; label: string }[]) {
  return (
    <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: "wrap" }}>
      {selected.map((value) => {
        const option = options.find((item) => item.value === value);
        return <Chip key={value} label={option?.label ?? value} size="small" />;
      })}
    </Stack>
  );
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


function parseRelayInput(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[\n,]/)
        .map((relay) => relay.trim())
        .filter(Boolean),
    ),
  );
}

function relaySearchParams(relays: string[]): string {
  const params = new URLSearchParams();
  for (const relay of relays) {
    params.append("relay", relay);
  }
  return params.toString();
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}
