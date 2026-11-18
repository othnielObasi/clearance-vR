import { expect, it } from 'vitest';
// @ts-expect-error plain JS companion-server module
import { relayPacketAllowed } from '../server/src/relay-protocol.js';

it('never forwards forged relay notifications from either player', () => {
  for (const role of ['host', 'guest']) {
    for (const t of ['room', 'joined', 'peer', 'error']) expect(relayPacketAllowed(role, JSON.stringify({ t }))).toBe(false);
  }
});

it('keeps snapshots authoritative and allows both players to share hands', () => {
  expect(relayPacketAllowed('host', '{"t":"snap"}')).toBe(true);
  expect(relayPacketAllowed('guest', '{"t":"snap"}')).toBe(false);
  expect(relayPacketAllowed('guest', '{"t":"act"}')).toBe(true);
  expect(relayPacketAllowed('host', '{"t":"act"}')).toBe(false);
  for (const role of ['host', 'guest']) expect(relayPacketAllowed(role, '{"t":"hands"}')).toBe(true);
});

it('ignores malformed or unknown relay data', () => {
  for (const data of ['null', '{}', '[]', '{', '{"t":"other"}']) expect(relayPacketAllowed('host', data)).toBe(false);
});
