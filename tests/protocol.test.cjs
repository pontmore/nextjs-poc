const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, rmSync, symlinkSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { resolve, join } = require('node:path');
const output = mkdtempSync(join(tmpdir(), 'pontmore-tests-'));
try {
  execFileSync(resolve('node_modules/.bin/tsc'), ['lib/pip00.ts', 'lib/pip01.ts', 'lib/nostr-relays.ts', 'lib/server/api-utils.ts', 'lib/server/addressable-cache.ts', '--outDir', output, '--module', 'commonjs', '--moduleResolution', 'node', '--target', 'es2022', '--esModuleInterop', '--skipLibCheck', '--strict'], { stdio: 'inherit' });
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
