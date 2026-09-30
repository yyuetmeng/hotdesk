import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseChirpstack, parseTtn, presenceFrom } from '../src/integrations.js';

test('presenceFrom understands common vendor payloads', () => {
  const cases = [
    [{ occupancy: 'occupied' }, true], // Milesight VS/WS desk sensors
    [{ occupancy: 'vacant' }, false],
    [{ pir: 'trigger' }, true],
    [{ pir: 'idle' }, false],
    [{ occupancy: 2 }, true], // Elsys: 0 free, 1 pending, 2 occupied
    [{ occupancy: 0 }, false],
    [{ Occupied: true }, true],
    [{ presence: false }, false],
    [{ motion: 3 }, true],
    [{ data: { occupancy_status: 'Occupied' } }, true], // nested one level
    [{ status: 'normal', occupancy: 'vacant' }, false], // unrelated "status" skipped
    [{ battery: 98, temperature: 22.5 }, undefined], // heartbeat / battery report
    [null, undefined],
  ];
  for (const [payload, expected] of cases) assert.equal(presenceFrom(payload), expected, JSON.stringify(payload));
});

test('parseTtn reads a The Things Stack uplink', () => {
  const r = parseTtn({
    end_device_ids: { device_id: 'desk-l1-df-01', dev_eui: '24E124136B316941' },
    received_at: '2026-09-30T09:00:00Z',
    uplink_message: { decoded_payload: { occupancy: 'occupied', battery: 90 }, received_at: '2026-09-30T09:00:01Z' },
  });
  assert.deepEqual(r, {
    ids: ['24E124136B316941', 'desk-l1-df-01'],
    name: 'desk-l1-df-01',
    presence: true,
    at: Date.parse('2026-09-30T09:00:01Z'),
  });
  assert.equal(parseTtn({ end_device_ids: { dev_eui: 'X' }, join_accept: {} }), null);
});

test('parseChirpstack reads uplinks and ignores other events', () => {
  const body = { deviceInfo: { devEui: 'a84041000181c61e', deviceName: 'S-L2-GO-01' }, object: { pir: 'idle' }, time: '2026-09-30T09:00:00Z' };
  assert.deepEqual(parseChirpstack(body, 'up'), {
    ids: ['a84041000181c61e', 'S-L2-GO-01'],
    name: 'S-L2-GO-01',
    presence: false,
    at: Date.parse('2026-09-30T09:00:00Z'),
  });
  assert.equal(parseChirpstack(body, 'join'), null);
  assert.equal(parseChirpstack({}, 'up'), null);
});
