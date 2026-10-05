# nextjs-pontmore

Next.js + TypeScript proof of concept for publishing, discovering, and inspecting Pontmore protocol events on Nostr.

The app defaults to these relays:

- `wss://nos.lol`
- `wss://relay.damus.io`

## Run

```bash
npm install
npm run dev
```

Open `http://localhost:3001`. Port `3001` is the default for both development and production. Set `PORT` or pass `--port` to use another port:

```bash
PORT=4100 npm run dev
npm run dev -- --port 4100

npm run build
PORT=4100 npm start
npm start -- --port 4100
```

Docker also accepts a runtime port override, for example `docker run --rm -e PORT=4100 -p 4100:4100 pontmore/nextjs-pontmore`.

## Docker

Build and run the production image locally:

```bash
docker build -t pontmore/nextjs-pontmore .
docker run --rm -p 3001:3001 pontmore/nextjs-pontmore
```

The GitHub Actions workflow in `.github/workflows/publish-docker.yml` publishes `pontmore/nextjs-pontmore` to Docker Hub on every push to `main`.

Required repository secrets:

- `DOCKER_PONTMORE_OWNER`
- `DOCKER_HUB_PONTMORE_PUBLISH_TOKEN`

## Behavior

- Agents live at `/agents`, with publishing at `/agents/publishing`. Escrows live at `/escrows`, with publishing at `/escrows/publishing`. Dashboard navigation uses page links; Settings and Profile also have dedicated `/settings` and `/profile` routes. Existing `/?tab=…` bookmarks redirect to the corresponding page, preserving definition lookups.
- Generates local Nostr identities in browser `localStorage`.
- Publishes kind `30360` addressable PIP-00 agent definition events.
- Publishes kind `30361` addressable PIP-01 escrow descriptor events.
- Supports server-side relay reads, lookup, publishing, and process-local caching through Next.js API routes.
- Provides discovery filters, pubkey/coordinate lookup, copyable coordinates, and JSON definition inspection for agent and escrow cards.
- Lets relay defaults be edited from the Settings page.
- `/coordinations` discovers signed public kind `7300` roots and tracks known roots saved in this browser (hex IDs, `note`, or `nevent`). `/coordinations/<root-id>` shows participants, terms, predecessor-linked history, and signed events.
- `/coordinations/swaps` lists `pontmore/swap@1` roots with custom fiat/Bitcoin details, status/search filters, completion rate, settled satoshis, and separate proposed/settled fiat volumes per currency. Amounts use exact decimal arithmetic. Completion is settled public chains divided by all loaded swap roots; detected invalid, incomplete, or forked chains do not contribute volume.
- The Coordinations submenu groups unique profiles discovered from public and known roots. `pontmore/swap@1` opens Swaps; other profiles open `/coordinations/profiles/<normalized-profile-id>` with a filtered public viewer. The generic normalizer maps `namespace/name@version` to `namespace-name-version` (for example `rollpot-game-1` and `pontmore-swap-1`), preserves the original pinned ID in event data, and disambiguates collisions with an exact-profile query. Existing encoded profile URLs and `/coordinations/swaps` redirect to canonical routes. The shared sidebar discovers profiles using root-only reads, caches them briefly in the browser session, and updates when the viewer loads additional profiles.
- Coordination pages share the dashboard sidebar, header, identity card, mobile navigation, and relay Settings. Coordination reads use the configured relays (up to 8), with bounded samples of 100 roots and 2,000 actions per relay per request. Known-root requests are additional exact-ID lookups (up to 50). Aggregate metrics cover the loaded sample and do not change with list filters. Relay failures, missing roots, unsupported formats, and unresolved history are shown explicitly.

The relay WebSocket client is intentionally small and lives in `lib/nostr-relays.ts`. Server-side cache orchestration lives in `lib/server/`.

## Protocol baseline

Discovery is aligned with [Pontmore protocol revision `d9a1eb3`](https://github.com/pontmore/protocol/tree/d9a1eb3e8a24e2101f5a4024df1ce85a8d934f75) (checked 2026-10-03):

- **PIP-00 v1:** a non-empty list of versioned capability identifiers, matching `pontmore-capability:` tags, and optional marked escrow references. Names and descriptions use kind 0 profiles; relay preferences belong in standard Nostr relay-list events. Commercial terms are outside this capability index.
- **PIP-01 v1:** mechanism, networks, `expires_at`, and optional `service.schema` (`openapi` or `asyncapi`, HTTPS URL). Includes Lightning hold, custodial, and Cashu mechanisms. Funding, release, refunds, fees, disputes, and recovery are defined by the referenced service schema.
- Relay reads and publish routes verify event signatures. Publish routes also validate the relevant discovery schema. Invalid/legacy discovery content is shown with validation errors and cannot prefill the publishing forms. Republish a current definition to migrate; old content is not converted into a capability claim.
- Addressable replacement uses newest timestamp, then lowest event ID on a tie. An expired replacement remains the current descriptor; it does not expose an older revision as selectable. Expired descriptors remain inspectable and are excluded from suggested escrow references.

This app implements discovery and read-only public inspection, including experimental PIP-02 version 2 linkage and `pontmore/swap@1` public replay (specifications checked against public `main` on 2026-10-04). Other profiles show linked, authority-checked kernel claims and keep domain-specific completion conditions uninterpreted. Every profile page reuses the economic summary template: loaded roots, recorded completion, completed value, review count, and separate exact proposed/completed value components. Rollpot `amount_sats` is interpreted as a per-player stake under its two-player Lightning funding model; generic profiles expose value through explicit amount/currency, amount/unit, amount/asset objects or integer `_sats` fields. Unrecognized or unsafe amounts remain unavailable, and fees/totals are not combined. Swap replay checks role bindings, signer authority, action data, deadlines, settlement/refund gates, disputes, and forks; elapsed deadlines alone do not choose an outcome. It does not fetch service schemas, validate historical descriptor selection or private commitment bytes, invoke escrow services, or independently verify actual payments. Outcomes are public-chain observations, not a full conformance or service-safety claim. A capability declaration does not prove implementation or availability. Before an economic action, a full client must validate the current descriptor, fetch and validate its schema with destination/redirect/size safety checks, and bind the exact accepted descriptor event ID in the coordination.

## Checks

```bash
npm test
npm run typecheck
npm run build
```
