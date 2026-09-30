import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkinUrl, qrSvg, renderLabelsPage } from '../src/labels.js';

test('checkinUrl joins base and desk id', () => {
  assert.equal(checkinUrl('https://x.test/', 'L1-DF-01'), 'https://x.test/checkin?seat=L1-DF-01');
  assert.equal(checkinUrl('https://x.test/hotdesk', 'A B'), 'https://x.test/hotdesk/checkin?seat=A%20B');
});

test('qrSvg renders a square code with a quiet zone', () => {
  const svg = qrSvg('https://x.test/checkin?seat=L1-DF-01');
  const [, size] = svg.match(/viewBox="0 0 (\d+) \1"/);
  // Version 2 or 3 (25 or 29 modules) plus 4 modules of quiet zone on each side.
  assert.ok([33, 37].includes(Number(size)), `unexpected size ${size}`);
  assert.match(svg, /<path d="M4,4h7v1h-7z/); // top-left finder pattern starts inside the quiet zone
});

test('labels page escapes text and has one label per seat', () => {
  const html = renderLabelsPage({
    seats: [{ id: 'L1-X-01', floorName: 'Level <1>', zoneName: 'Zone & Co' }],
    baseUrl: 'https://x.test',
    buildingName: 'HQ',
  });
  assert.equal((html.match(/class="label"/g) ?? []).length, 1);
  assert.match(html, /Level &lt;1&gt;/);
  assert.match(html, /Zone &amp; Co/);
});
