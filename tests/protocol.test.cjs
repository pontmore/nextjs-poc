const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, rmSync, symlinkSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { resolve, join } = require('node:path');
const output = mkdtempSync(join(tmpdir(), 'pontmore-tests-'));
try {
  execFileSync(resolve('node_modules/.bin/tsc'), ['lib/coordination-economics.ts', 'lib/coordinations.ts', 'lib/pip00.ts', 'lib/pip01.ts', 'lib/nostr-relays.ts', 'lib/server/api-utils.ts', 'lib/server/addressable-cache.ts', '--outDir', output, '--module', 'commonjs', '--moduleResolution', 'node', '--target', 'es2022', '--esModuleInterop', '--skipLibCheck', '--strict'], { stdio: 'inherit' });
  symlinkSync(resolve('node_modules'), join(output, 'node_modules'), 'dir');
} catch (error) { rmSync(output, { recursive: true, force: true }); throw error; }
after(() => rmSync(output, { recursive: true, force: true }));
const { finalizeEvent, generateSecretKey, getPublicKey } = require('nostr-tools');
const agent = require(join(output, 'pip00.js'));
const escrow = require(join(output, 'pip01.js'));
const relay = require(join(output, 'nostr-relays.js'));
const { parseLookupFilter } = require(join(output, 'server/api-utils.js'));
const secret = generateSecretKey();
const pubkey = getPublicKey(secret);
const coordinate = `30361:${pubkey}:escrow:lightning`;
const buildAgent = () => agent.buildAgentEvent({ pubkey, identifier: 'agent', capabilities: ['pontmore/swap@1', 'example/game@2'], escrowAddress: coordinate });
const buildEscrow = (extra = {}) => escrow.buildEscrowEvent({ pubkey, identifier: 'escrow', escrowType: 'cashu_escrow', networks: ['cashu'], expiresAt: 1800000000, schemaType: 'openapi', schemaUrl: 'https://example.com/escrow/v1.json', ...extra });
const withContent = (event, change) => ({ ...event, content: JSON.stringify(change(JSON.parse(event.content))) });

test('PIP-00 publishes only the capability index with matching tags and marked escrow reference', () => {
  const event = buildAgent();
  assert.deepEqual(JSON.parse(event.content), { version: 1, capabilities: ['pontmore/swap@1', 'example/game@2'] });
  assert.ok(event.tags.some((tag) => tag.join('|') === `a|${coordinate}||escrow`));
  assert.deepEqual(agent.validateAgentEvent(event), []);
});
test('missing and extra capability claims are rejected', () => {
  const event = buildAgent();
  assert.ok(agent.validateAgentEvent({ ...event, tags: event.tags.filter((tag) => tag[1] !== 'pontmore-capability:pontmore/swap@1') }).length);
  assert.ok(agent.validateAgentEvent({ ...event, tags: [...event.tags, ['t', 'pontmore-capability:example/extra@1']] }).length);
});
test('legacy and unknown-version Agent content is rejected', () => {
  assert.ok(agent.validateAgentEvent(withContent(buildAgent(), () => ({ version: 'PIP-00-draft', capabilities: { swap_types: ['btc-to-fiat'] } }))).length);
  assert.ok(agent.validateAgentEvent(withContent(buildAgent(), (content) => ({ ...content, version: 2 }))).length);
  assert.throws(() => agent.buildAgentEvent({ pubkey, identifier: 'agent', capabilities: ['swap@1'] }));
});
test('Agent escrow references are optional and do not silently select an operator', () => {
  const event = agent.buildAgentEvent({ pubkey, identifier: 'agent', capabilities: ['pontmore/swap@1'] });
  assert.equal(event.tags.some((tag) => tag[0] === 'a'), false);
});
test('PIP-01 publishes compact content and canonical network indexes', () => {
  const event = buildEscrow();
  assert.deepEqual(Object.keys(JSON.parse(event.content)), ['version', 'escrow_type', 'networks', 'expires_at', 'service']);
  assert.ok(event.tags.some((tag) => tag[1] === 'pontmore-network:cashu'));
  assert.deepEqual(escrow.validateEscrowEvent(event), []);
});
test('PIP-01 rejects inconsistent network indexes and missing subtype networks', () => {
  const event = buildEscrow();
  assert.ok(escrow.validateEscrowEvent({ ...event, tags: [...event.tags, ['t', 'pontmore-network:lightning']] }).length);
  assert.throws(() => buildEscrow({ networks: ['bitcoin'] }));
  assert.throws(() => buildEscrow({ escrowType: 'lightning_hold_invoice', networks: ['bitcoin'] }));
});
test('expiry is required and expired replacements remain valid but cannot be selected', () => {
  assert.ok(escrow.validateEscrowEvent(withContent(buildEscrow(), ({ expires_at, ...rest }) => rest)).length);
  const parsed = escrow.parseEscrowEvent(finalizeEvent(buildEscrow({ expiresAt: 1 }), secret));
  assert.equal(parsed.malformedContent, false);
  assert.equal(escrow.isEscrowExpired(parsed, 1), true);
  assert.equal(escrow.isEscrowExpired(parsed, 0), false);
});
test('service interface is optional, schema-only, and requires supported type and HTTPS', () => {
  assert.deepEqual(escrow.validateEscrowEvent(buildEscrow({ schemaUrl: '' })), []);
  assert.throws(() => buildEscrow({ schemaUrl: 'http://example.com/schema' }));
  assert.throws(() => buildEscrow({ schemaUrl: 'https://user:secret@example.com/schema' }));
  assert.ok(escrow.validateEscrowEvent(withContent(buildEscrow(), (c) => ({ ...c, service: { ...c.service, endpoint: 'https://example.com' } }))).length);
});
test('untrusted JSON primitives and wrong field types cannot crash parsers', () => {
  for (const content of ['null', '[]', 'false', '{"version":1,"networks":"cashu"}', 'bad json']) {
    assert.equal(agent.parseAgentEvent({ ...buildAgent(), content }).malformedContent, true);
    assert.equal(escrow.parseEscrowEvent({ ...buildEscrow(), content }).malformedContent, true);
  }
});
test('relay events require verified signatures, intact content, and string tags', () => {
  const event = finalizeEvent(buildAgent(), secret);
  assert.equal(relay.isNostrEvent(event), true);
  // Use fresh objects: nostr-tools caches successful verification on the verified object.
  assert.equal(relay.isNostrEvent({ ...event, content: '{}' }), false);
  assert.equal(relay.isNostrEvent({ ...event, tags: [[42]] }), false);
});
test('relay reads match the requested kind, author, and tags', () => {
  const event = finalizeEvent(buildAgent(), secret);
  assert.equal(relay.matchesNostrFilter(event, { kinds: [30361] }), false);
  assert.equal(relay.matchesNostrFilter(event, { authors: ['0'.repeat(64)] }), false);
  assert.equal(relay.matchesNostrFilter(event, { '#d': ['other'] }), false);
  assert.equal(relay.matchesNostrFilter(event, { kinds: [30360], '#t': ['agent'] }), true);
});
test('lookup cannot contaminate directories with other kinds and preserves colon identifiers', () => {
  assert.equal(parseLookupFilter(`30361:${pubkey}:escrow`, 30360), null);
  assert.equal(parseLookupFilter(`30360abc:${pubkey}:agent`, 30360), null);
  assert.deepEqual(parseLookupFilter(coordinate, 30361)['#d'], ['escrow:lightning']);
});

test('addressable replacement is independent of arrival order and uses lowest ID on timestamp ties', async () => {
  const { createAddressableEventCache } = require(join(output, 'server/addressable-cache.js'));
  const originalFetch = relay.fetchFromRelays;
  const base = { ...buildEscrow(), created_at: 100 };
  const lowest = { ...base, id: '1'.repeat(64) };
  const higher = { ...base, id: '2'.repeat(64) };
  try {
    for (const events of [[higher, lowest], [lowest, higher]]) {
      relay.fetchFromRelays = async () => ({ events, results: [] });
      const cache = createAddressableEventCache({ kinds: [30361] });
      assert.equal((await cache.refresh(['wss://example.com'])).events[0].id, lowest.id);
    }
  } finally { relay.fetchFromRelays = originalFetch; }
});
test('an expired current descriptor never falls back to an older selectable revision', async () => {
  const { createAddressableEventCache } = require(join(output, 'server/addressable-cache.js'));
  const originalFetch = relay.fetchFromRelays;
  const previous = { ...buildEscrow(), created_at: 100, id: '1'.repeat(64) };
  const withdrawn = { ...buildEscrow({ expiresAt: 101 }), created_at: 101, id: '2'.repeat(64) };
  try {
    const cache = createAddressableEventCache({ kinds: [30361] });
    relay.fetchFromRelays = async () => ({ events: [previous, withdrawn], results: [] });
    const first = await cache.refresh(['wss://example.com']);
    assert.equal(first.events[0].id, withdrawn.id);
    assert.equal(escrow.isEscrowExpired(escrow.parseEscrowEvent(first.events[0]), 101), true);
    relay.fetchFromRelays = async () => ({ events: [previous], results: [] });
    assert.equal((await cache.refresh(['wss://example.com'])).events[0].id, withdrawn.id);
  } finally { relay.fetchFromRelays = originalFetch; }
});

const coordination = require(join(output, 'coordinations.js'));
const customerKey = generateSecretKey(), escrowKey = generateSecretKey(), resolverKey = generateSecretKey();
const customerPubkey = getPublicKey(customerKey), escrowPubkey = getPublicKey(escrowKey), resolverPubkey = getPublicKey(resolverKey);
function swapRoot(direction = 'fiat_to_btc', extra = {}) {
  return finalizeEvent({ kind: 7300, created_at: 100, tags: [['p', pubkey, '', 'swap/agent'], ['p', customerPubkey, '', 'swap/customer'], ['p', escrowPubkey, '', 'core/escrow'], ['p', resolverPubkey, '', 'core/resolver'], ['e', 'a'.repeat(64), '', 'escrow-version'], ['a', coordinate, '', 'escrow']], content: JSON.stringify({ version: 2, profile: 'pontmore/swap@1', expires_at: 200, terms: { direction, fiat: { currency: 'KES', amount: '1000.10' }, bitcoin: { amount: '60000', unit: 'sat', network: 'lightning' }, payment_channel: 'mpesa-ke-kes@1', deadlines: { fiat_pay_by: 300, fiat_confirm_by: 400 } }, ...extra }) }, secret);
}
function action(root, prev, name, key, at = 150, data) {
  return finalizeEvent({ kind: 7301, created_at: at, tags: [['e', root.id, '', 'root'], ['e', prev.id, '', 'prev']], content: JSON.stringify({ version: 2, action: name, ...(data ? { data } : {}) }) }, key);
}
function settlement(direction = 'fiat_to_btc') {
  const root = swapRoot(direction); const sender = direction === 'fiat_to_btc' ? customerKey : secret, receiver = direction === 'fiat_to_btc' ? secret : customerKey;
  const actions = []; let prev = root;
  for (const [name, key, data] of [['core/accept', customerKey], ['core/secure', escrowKey], ['swap/fiat_sent', sender, { payment_reference: 'opaque_test_reference' }], ['swap/fiat_confirmed', receiver, { payment_reference: 'opaque_test_reference' }], ['core/authorize_settlement', receiver], ['core/settle', escrowKey]]) { prev = action(root, prev, name, key, 150, data); actions.push(prev); }
  return { root, actions };
}
test('coordination identifiers support hex, note and nevent', () => {
  const { nip19 } = require('nostr-tools'); const id = 'b'.repeat(64);
  assert.equal(coordination.parseRootId(id.toUpperCase()), id);
  assert.equal(coordination.parseRootId(nip19.noteEncode(id)), id);
  assert.equal(coordination.parseRootId('nostr:' + nip19.neventEncode({ id })), id);
  assert.equal(coordination.parseRootId(coordinate), null);
});
test('both swap directions reconstruct settlement by links regardless of input order and duplicates', () => {
  for (const direction of ['fiat_to_btc', 'btc_to_fiat']) {
    const { root, actions } = settlement(direction);
    const item = coordination.reconstructCoordination(root, [...actions].reverse().concat(actions[0]));
    assert.equal(item.state, 'settled'); assert.deepEqual(item.issues, []); assert.equal(item.history.length, 6);
  }
});
test('expired acceptance, wrong escrow and missing settlement authorization cannot count as completed', () => {
  const root = swapRoot();
  const expired = action(root, root, 'core/accept', customerKey, 200);
  assert.equal(coordination.reconstructCoordination(root, [expired]).state, 'invalid');
  const accept = action(root, root, 'core/accept', customerKey);
  const forged = action(root, accept, 'core/secure', secret);
  assert.equal(coordination.reconstructCoordination(root, [accept, forged]).state, 'invalid');
  const earlySettle = action(root, accept, 'core/settle', escrowKey);
  const item = coordination.reconstructCoordination(root, [accept, earlySettle]);
  assert.equal(coordination.swapMetrics([item]).settled, 0);
});
test('sibling forks and missing predecessors freeze outcomes and retain branches', () => {
  const { root, actions } = settlement();
  const sibling = action(root, actions[4], 'core/settle', escrowKey, 151);
  const fork = coordination.reconstructCoordination(root, [...actions, sibling]);
  assert.equal(fork.state, 'forked'); assert.equal(fork.actions.length, 7); assert.equal(coordination.swapMetrics([fork]).settled, 0);
  const missing = coordination.reconstructCoordination(root, actions.slice(1));
  assert.equal(missing.state, 'incomplete'); assert.equal(coordination.swapMetrics([missing]).settled, 0);
});
test('mismatched confirmations and actions after terminal settlement are excluded', () => {
  const { root, actions } = settlement();
  const mismatch = action(root, actions[2], 'swap/fiat_confirmed', secret, 155, { payment_reference: 'different_reference' });
  assert.equal(coordination.reconstructCoordination(root, [...actions.slice(0, 3), mismatch]).state, 'invalid');
  const refund = action(root, actions[5], 'core/refund', escrowKey);
  assert.equal(coordination.reconstructCoordination(root, [...actions, refund]).state, 'invalid');
});
test('refund requires no-payment deadline and the Bitcoin provider', () => {
  const root = swapRoot(); const accept = action(root, root, 'core/accept', customerKey); const secure = action(root, accept, 'core/secure', escrowKey);
  const early = action(root, secure, 'core/authorize_refund', secret, 299);
  assert.equal(coordination.reconstructCoordination(root, [accept, secure, early]).state, 'invalid');
  const authorize = action(root, secure, 'core/authorize_refund', secret, 300); const refund = action(root, authorize, 'core/refund', escrowKey, 301);
  assert.equal(coordination.reconstructCoordination(root, [accept, secure, authorize, refund]).state, 'refunded');
});
test('disputes freeze settlement until the bound resolver authorizes it', () => {
  const { root, actions } = settlement(); const open = action(root, actions[1], 'core/open_dispute', customerKey);
  const blocked = action(root, open, 'core/settle', escrowKey);
  assert.equal(coordination.reconstructCoordination(root, [...actions.slice(0, 2), open, blocked]).state, 'invalid');
  const resolved = action(root, open, 'core/resolve_dispute', resolverKey, 160, { policy: 'test-policy@1', effect: 'authorize_settlement' });
  const settled = action(root, resolved, 'core/settle', escrowKey, 161);
  assert.equal(coordination.reconstructCoordination(root, [...actions.slice(0, 2), open, resolved, settled]).state, 'settled');
});
test('exact volumes remain separate by currency and completion uses the loaded sample', () => {
  const { root, actions } = settlement(); const completed = coordination.reconstructCoordination(root, actions);
  const pending = coordination.reconstructCoordination(swapRoot('btc_to_fiat'), []);
  const metrics = coordination.swapMetrics([completed, pending]);
  assert.equal(metrics.completionRate, 50); assert.equal(metrics.settledSats, '60000'); assert.deepEqual(metrics.volumes.KES, { proposed: '2000.2', settled: '1000.1' });
  assert.equal(coordination.addDecimal('9007199254740993.00000001', '0.00000009'), '9007199254740993.0000001');
  assert.equal(coordination.addDecimal('100.00', '0'), '100'); assert.equal(coordination.swapMetrics([]).completionRate, null);
});
test('unsupported roots, forged signatures and malformed swap terms cannot produce metrics', () => {
  assert.equal(coordination.reconstructCoordination(swapRoot('fiat_to_btc', { version: 1 }), []), null);
  const root = swapRoot(); assert.equal(coordination.reconstructCoordination({ ...root, content: '{}' }, []), null);
  const invalid = swapRoot('fiat_to_btc', { terms: { direction: 'fiat_to_btc' } });
  assert.equal(coordination.swapMetrics([coordination.reconstructCoordination(invalid, [])]).settled, 0);
});
test('relay filters isolate exact coordination IDs and referenced roots', () => {
  const { root, actions } = settlement();
  assert.equal(relay.matchesNostrFilter(root, { ids: ['c'.repeat(64)] }), false);
  assert.equal(relay.matchesNostrFilter(actions[0], { kinds: [7301], '#e': [root.id] }), true);
  assert.equal(relay.matchesNostrFilter(actions[0], { '#e': ['c'.repeat(64)] }), false);
});
test('commitment payment references compare by digest independent of JSON property order', () => {
  const root = swapRoot(); const accept = action(root, root, 'core/accept', customerKey), secure = action(root, accept, 'core/secure', escrowKey);
  const digest = 'sha256:' + 'a'.repeat(64);
  const sent = action(root, secure, 'swap/fiat_sent', customerKey, 150, { payment_reference: { algorithm: 'sha256-bytes@1', digest } });
  const confirmed = action(root, sent, 'swap/fiat_confirmed', secret, 150, { payment_reference: { digest, algorithm: 'sha256-bytes@1' } });
  assert.equal(coordination.reconstructCoordination(root, [accept, secure, sent, confirmed]).state, 'fiat_confirmed');
});
test('malformed linked events remain inspectable and malformed swaps stay in the completion denominator', () => {
  const root = swapRoot(); const malformed = action(root, root, 'core/accept', customerKey, 150, { raw_payment_details: 'invalid' });
  const item = coordination.reconstructCoordination(root, [malformed]);
  assert.equal(item.state, 'invalid'); assert.equal(item.linkedEvents.length, 1);
  const badRoot = swapRoot('fiat_to_btc', { terms: {} });
  const malformedSwap = coordination.reconstructCoordination(badRoot, []);
  const { root: validRoot, actions } = settlement(); const valid = coordination.reconstructCoordination(validRoot, actions);
  const metrics = coordination.swapMetrics([valid, valid, malformedSwap]);
  assert.equal(metrics.total, 2); assert.equal(metrics.completionRate, 50); assert.equal(metrics.uncertain, 1);
});
test('profile discovery deduplicates exact pinned IDs, keeps versions distinct, and rejects invalid identifiers', () => {
  const profiles = coordination.coordinationProfiles([{ profile: 'example/work@2' }, { profile: 'pontmore/swap@1' }, { profile: 'example/work@1' }, { profile: 'example/work@2' }, { profile: 'javascript:alert(1)' }]);
  assert.deepEqual(profiles, ['example/work@1', 'example/work@2', 'pontmore/swap@1']);
  assert.equal(coordination.coordinationProfileHref('pontmore/swap@1'), '/coordinations/profiles/pontmore-swap-1');
  assert.equal(coordination.coordinationProfileHref('example.a/work-b@2'), '/coordinations/profiles/example.a-work-b-2');
  assert.equal(coordination.isCoordinationProfile('example.a/work-b@2'), true);
  assert.equal(coordination.isCoordinationProfile('example/work@0'), false);
  const generic = swapRoot('fiat_to_btc', { profile: 'example/work@1', terms: {} });
  assert.deepEqual(coordination.coordinationProfiles([coordination.reconstructCoordination(generic, [])]), ['example/work@1']);
});
test('profile paths decode encoded catch-all segments before validation', () => {
  assert.equal(coordination.parseCoordinationProfilePath(['rollpot%2Fgame%401']), 'rollpot/game@1');
  assert.equal(coordination.parseCoordinationProfilePath(['rollpot', 'game%401']), 'rollpot/game@1');
  assert.equal(coordination.parseCoordinationProfilePath(['rollpot', 'game@1']), 'rollpot/game@1');
  assert.equal(coordination.parseCoordinationProfilePath(['example%2Fbad%zz']), null);
  assert.equal(coordination.parseCoordinationProfilePath(['rollpot%2Fgame%400']), null);
});

test('generic profile normalization preserves version and handles colliding IDs without guessing', () => {
  for (const [profile, slug] of [['pontmore/swap@1', 'pontmore-swap-1'], ['rollpot/game@1', 'rollpot-game-1'], ['future.namespace/custom_work@12', 'future.namespace-custom_work-12'], ['another-team/new-work@3', 'another-team-new-work-3']]) {
    assert.equal(coordination.normalizeCoordinationProfile(profile), slug);
    assert.equal(coordination.isCoordinationProfileSlug(slug), true);
  }
  assert.throws(() => coordination.normalizeCoordinationProfile('unversioned/profile'));
  const profiles = ['a-b/c@1', 'a/b-c@1'];
  assert.equal(coordination.normalizeCoordinationProfile(profiles[0]), coordination.normalizeCoordinationProfile(profiles[1]));
  assert.equal(coordination.coordinationProfileHref(profiles[0], profiles), '/coordinations/profiles/a-b-c-1?profile=a-b%2Fc%401');
  assert.equal(coordination.coordinationProfileHref(profiles[1], profiles), '/coordinations/profiles/a-b-c-1?profile=a%2Fb-c%401');
});

const economics = require(join(output, 'coordination-economics.js'));
function rollpotRoot(stake = 2100) {
  return finalizeEvent({ kind: 7300, created_at: 100, tags: [['p', pubkey, '', 'game/player1'], ['p', customerPubkey, '', 'game/player2'], ['p', escrowPubkey, '', 'core/escrow'], ['e', 'a'.repeat(64), '', 'escrow-version'], ['a', coordinate, '', 'escrow']], content: JSON.stringify({ version: 2, profile: 'rollpot/game@1', expires_at: 200, terms: { amount_sats: stake, funding_model: '2_of_2', payout_network: 'lightning', game_mode: 'higher_roll_wins', fund_by: 300, result_by: 400, recover_by: 500 } }) }, secret);
}
test('shared economic metrics count Rollpot two-player pots and linked escrow outcome claims', () => {
  const root = rollpotRoot(), actions = []; let prev = root;
  for (const [name, key, data] of [['core/accept', secret], ['core/accept', customerKey], ['core/secure', escrowKey], ['game/roll', secret, { round: 1, value: 6 }], ['game/roll', customerKey, { round: 1, value: 1 }], ['game/result', secret, { winner: 'creator' }], ['core/authorize_settlement', secret], ['core/settle', escrowKey]]) { prev = action(root, prev, name, key, 150, data); actions.push(prev); }
  const game = coordination.reconstructCoordination(root, actions);
  assert.equal(game.state, 'settled_claimed'); assert.deepEqual(game.issues, []);
  const pending = coordination.reconstructCoordination(rollpotRoot(3000), []);
  const metrics = economics.coordinationEconomicMetrics([game, pending]);
  assert.equal(metrics.completionRate, 50); assert.equal(metrics.completed, 1);
  assert.deepEqual(metrics.values.map(v => [v.component, v.asset, v.proposed, v.completed]), [['Two-player pot', 'sat', '10200', '4200']]);
  const wrongEscrow = action(root, actions[6], 'core/settle', customerKey);
  const invalid = coordination.reconstructCoordination(root, [...actions.slice(0, 7), wrongEscrow]);
  assert.equal(invalid.state, 'invalid'); assert.equal(economics.coordinationEconomicMetrics([invalid]).values.length, 0);
});
test('generic economic values retain exact separate currencies and components without counting fees twice', () => {
  const root = swapRoot('fiat_to_btc', { profile: 'future/task@1', terms: { total: { amount: '9007199254740993.00000001', currency: 'USD' }, fee: { amount: '0.00000009', currency: 'USD' }, reward: { amount: '50', unit: 'credits' } } });
  const item = coordination.reconstructCoordination(root, []);
  const metrics = economics.coordinationEconomicMetrics([item]);
  assert.equal(metrics.valued, 1); assert.equal(metrics.values.length, 3);
  assert.equal(metrics.values.find(v => v.component === 'terms.total').proposed, '9007199254740993.00000001');
  assert.equal(metrics.values.find(v => v.component === 'terms.fee').proposed, '0.00000009');
  const opaque = coordination.reconstructCoordination(swapRoot('fiat_to_btc', { profile: 'future/task@2', terms: { amount: Number.MAX_SAFE_INTEGER + 1, currency: 'USD' } }), []);
  assert.equal(economics.coordinationEconomicMetrics([opaque]).unavailable, 1);
});
test('unknown profiles do not count settlement before security or authorize unbound actors', () => {
  const root = rollpotRoot(); const settle = action(root, root, 'core/settle', escrowKey);
  assert.equal(coordination.reconstructCoordination(root, [settle]).state, 'invalid');
  const authorize = action(root, root, 'core/authorize_settlement', secret);
  assert.equal(coordination.reconstructCoordination(root, [authorize]).state, 'invalid');
  const stranger = action(root, root, 'game/result', generateSecretKey());
  assert.equal(coordination.reconstructCoordination(root, [stranger]).state, 'invalid');
});
test('swaps and generic profiles use the same exact economic aggregation', () => {
  const { root, actions } = settlement(); const swap = coordination.reconstructCoordination(root, actions);
  const metrics = economics.coordinationEconomicMetrics([swap]);
  assert.equal(metrics.completed, 1); assert.equal(metrics.completionRate, 100);
  assert.equal(metrics.values.find(v => v.asset === 'KES').completed, '1000.1');
  assert.equal(metrics.values.find(v => v.asset === 'sat').completed, '60000');
});
test('dispute resolution cannot authorize settlement before a public security gate', () => {
  const root = swapRoot(); const accept = action(root, root, 'core/accept', customerKey);
  const dispute = action(root, accept, 'core/open_dispute', customerKey);
  const resolution = action(root, dispute, 'core/resolve_dispute', resolverKey, 155, { policy: 'test@1', effect: 'authorize_settlement' });
  assert.equal(coordination.reconstructCoordination(root, [accept, dispute, resolution]).state, 'invalid');
});
