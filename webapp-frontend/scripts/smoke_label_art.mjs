import assert from 'node:assert/strict';
import jsQR from 'jsqr';
import { centreSize, codeSvg, labelFontSize, labelSvg, qrMatrix } from '../src/qr/labelArt.js';

const link = 'https://hotdesk.example.com/checkin/0b8e5c1e-1234-4abc-9def-1234567890ab';
const m = qrMatrix(link);

// The cleared centre is odd-sized (truly centred) and stays under 10% of the code's area.
for (const n of [21, 45, 49, 57, 77]) {
  const k = centreSize(n);
  assert.equal(k % 2, 1);
  assert.ok((k * k) / (n * n) < 0.1, `centre too big for ${n}`);
}

// The code still decodes with the centre blanked out: draw the modules the SVG draws (no finder detail lost,
// centre empty) at 8px a module with a 4-module quiet zone, and read it back.
{
  const n = m.size, k = centreSize(n), k0 = (n - k) / 2, px = 8, side = (n + 8) * px;
  const data = new Uint8ClampedArray(side * side * 4).fill(255);
  for (let r = 0; r < n; r += 1) for (let c = 0; c < n; c += 1) {
    const inCentre = r >= k0 && r < k0 + k && c >= k0 && c < k0 + k;
    if (!m.dark(r, c) || inCentre) continue;
    for (let y = 0; y < px; y += 1) for (let x = 0; x < px; x += 1) {
      const i = (((r + 4) * px + y) * side + (c + 4) * px + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 0;
    }
  }
  assert.equal(jsQR(data, side, side)?.data, link);
}

// SVG text: sized as asked, the label and place escaped, the call to action present.
assert.match(codeSvg(m, 320), /^<svg [^>]*width="320" height="320"/);
const label = labelSvg(m, { label: 'A<07>', place: 'Level 3 · Zone "B"' });
assert.ok(label.includes('A&lt;07&gt;') && label.includes('Zone &quot;B&quot;') && label.includes('SCAN TO CHECK IN'));
assert.ok(!label.includes('<07>'));
assert.equal(labelFontSize('A07'), 60);
assert.ok(labelFontSize('L3-OPEN-PLAN-WINDOW-12') < 60 && labelFontSize('x'.repeat(200)) === 24);
console.log('label art smoke OK');
