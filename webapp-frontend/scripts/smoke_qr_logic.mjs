import assert from 'node:assert/strict';
import { crc32, makeZip } from '../src/qr/zip.js';
import { filterRows, labelFileNames, seatRows, teamOptions, zoneOptions } from '../src/qr/qrLogic.js';

// --- ZIP (store-only; PNGs are already compressed) ---
const enc = new TextEncoder();
assert.equal(crc32(enc.encode('123456789')), 0xcbf43926);           // standard CRC-32 check value
assert.equal(crc32(new Uint8Array()), 0);
{
  const zip = makeZip([{ name: 'a.txt', data: enc.encode('hello') }, { name: 'b/c.txt', data: enc.encode('') }]);
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  assert.equal(view.getUint32(0, true), 0x04034b50);                 // first local file header
  const eocd = zip.byteLength - 22;
  assert.equal(view.getUint32(eocd, true), 0x06054b50);              // end of central directory
  assert.equal(view.getUint16(eocd + 10, true), 2);                  // two entries
  const cdOffset = view.getUint32(eocd + 16, true);
  assert.equal(view.getUint32(cdOffset, true), 0x02014b50);          // central directory starts where it says
  assert.equal(view.getUint32(cdOffset + 16, true), crc32(enc.encode('hello')));
}

// --- Seat rows from GET /api/public/floors/<id> ---
const floor = {
  id: 'p1', name: 'Level 1',
  zones: [{ id: 'z1', name: 'AI Lab', x: 0, y: 0, w: 4, h: 2 }],
  seats: [
    { id: 's1', label: 'A1', x: 3, y: 1, department: 'SAP' },
    { id: 's2', label: 'A2', x: 4, y: 1, department: 'Free for all' },
    { id: 's3', label: 'B1', x: 9, y: 9, department: null },
  ],
};
const rows = seatRows(floor);
assert.deepEqual(rows.map((r) => [r.id, r.label, r.floorName, r.zone, r.team]), [
  ['s1', 'A1', 'Level 1', 'AI Lab', 'SAP'],
  ['s2', 'A2', 'Level 1', null, 'Free for all'],
  ['s3', 'B1', 'Level 1', null, null],
]);
assert.deepEqual(zoneOptions(rows), ['AI Lab']);
assert.deepEqual(teamOptions(rows), ['SAP']);
const all = { floor: 'all', zone: 'all', team: 'all', q: '' };
assert.equal(filterRows(rows, all).length, 3);
assert.deepEqual(filterRows(rows, { ...all, zone: 'AI Lab' }).map((r) => r.id), ['s1']);
assert.deepEqual(filterRows(rows, { ...all, zone: 'none' }).map((r) => r.id), ['s2', 's3']);
assert.deepEqual(filterRows(rows, { ...all, team: 'open' }).map((r) => r.id), ['s2']);
assert.deepEqual(filterRows(rows, { ...all, team: 'none' }).map((r) => r.id), ['s3']);
assert.deepEqual(filterRows(rows, { ...all, team: 'SAP' }).map((r) => r.id), ['s1']);
assert.deepEqual(filterRows(rows, { ...all, q: ' b1 ' }).map((r) => r.id), ['s3']);
assert.deepEqual(filterRows(rows, { ...all, floor: 'p2' }), []);

// --- File names: safe, and unique inside one zip ---
assert.deepEqual(labelFileNames([
  { floorName: 'Level 1', label: 'A1' }, { floorName: 'Level 1', label: 'A1' }, { floorName: 'L/2: East', label: 'Desk #3' },
]), ['Level-1_A1.png', 'Level-1_A1-2.png', 'L-2-East_Desk-3.png']);
console.log('qr logic smoke OK');

// "New" badge: a label is new until any admin has downloaded it; unknown (not loaded) shows no badge.
{
  const { isNewLabel, withDownloaded } = await import('../src/qr/qrLogic.js');
  const done = new Set(['s1']);
  assert.equal(isNewLabel(done, 's2'), true);
  assert.equal(isNewLabel(done, 's1'), false);
  assert.equal(isNewLabel(null, 's2'), false);
  const next = withDownloaded(done, ['s2', 's3']);
  assert.deepEqual([...next].sort(), ['s1', 's2', 's3']);
  assert.deepEqual([...done], ['s1']);                    // original untouched (React state)
}
console.log('qr new-badge smoke OK');

// Labels filter: all / new only / downloaded (needs the downloaded set; while loading, "new" shows nothing yet).
{
  const { filterRows } = await import('../src/qr/qrLogic.js');
  const rows2 = [{ id: 'a', label: 'A1', floorId: 'p', zone: null, team: null }, { id: 'b', label: 'B1', floorId: 'p', zone: null, team: null }];
  const base = { floor: 'all', zone: 'all', team: 'all', q: '' };
  const done = new Set(['a']);
  assert.deepEqual(filterRows(rows2, { ...base, label: 'all' }, done).map((r) => r.id), ['a', 'b']);
  assert.deepEqual(filterRows(rows2, { ...base, label: 'new' }, done).map((r) => r.id), ['b']);
  assert.deepEqual(filterRows(rows2, { ...base, label: 'downloaded' }, done).map((r) => r.id), ['a']);
  assert.deepEqual(filterRows(rows2, base, done).map((r) => r.id), ['a', 'b']);               // no label filter = all
  assert.deepEqual(filterRows(rows2, { ...base, label: 'new' }, null).map((r) => r.id), []);   // not loaded yet
}
console.log('qr labels filter smoke OK');
