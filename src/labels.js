import qrcode from 'qrcode-generator';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** The URL a desk's QR code opens: the employee check-in page for that desk. */
export function checkinUrl(baseUrl, seatId) {
  return `${baseUrl.replace(/\/+$/, '')}/checkin?seat=${encodeURIComponent(seatId)}`;
}

/** QR code as an inline SVG, with the 4-module quiet zone scanners need. */
export function qrSvg(text) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const quiet = 4;
  let d = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!qr.isDark(r, c)) continue;
      let run = 1;
      while (c + run < n && qr.isDark(r, c + run)) run++;
      d += `M${c + quiet},${r + quiet}h${run}v1h-${run}z`;
      c += run - 1;
    }
  }
  const size = n + quiet * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img" aria-label="QR code for ${esc(text)}"><rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

/**
 * A printable HTML page of desk labels. Sized for A4 sheets of 21 labels
 * (3 x 7, 63.5 x 38.1 mm, e.g. Avery L7160); plain paper works too.
 */
export function renderLabelsPage({ seats, baseUrl, buildingName }) {
  const labels = seats
    .map((s) => {
      const url = checkinUrl(baseUrl, s.id);
      return `<div class="label">
  ${qrSvg(url)}
  <div class="text">
    <div class="id">${esc(s.id)}</div>
    <div class="where">${esc(s.floorName)}<br>${esc(s.zoneName)}</div>
    <div class="cta">Scan to check in</div>
  </div>
</div>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Desk Labels</title>
<style>
  @page { size: A4; margin: 15.1mm 7.2mm 0 7.2mm; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #f4f4f2; color: #0b0b0b; font: 14px/1.4 system-ui, -apple-system, "Segoe UI", Arial, sans-serif; }
  .toolbar { max-width: 210mm; margin: 0 auto; padding: 16px; display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
  .toolbar h1 { font-size: 18px; margin: 0; flex: 1; min-width: 200px; }
  .toolbar p { margin: 4px 0 0; color: #52514e; font-size: 13px; word-break: break-all; }
  .toolbar button { font: inherit; font-weight: 600; padding: 8px 16px; border-radius: 8px; border: 0; background: #0b0b0b; color: #fff; cursor: pointer; }
  .sheet {
    width: 210mm; margin: 0 auto 24px; padding: 15.1mm 7.2mm; background: #fff;
    display: grid; grid-template-columns: repeat(3, 63.5mm); grid-auto-rows: 38.1mm; column-gap: 2.5mm;
  }
  .label { display: flex; align-items: center; gap: 2.5mm; padding: 2.5mm 3mm; overflow: hidden; break-inside: avoid; outline: 0.2mm dashed #d0cfca; }
  .label svg { width: 31mm; height: 31mm; flex: none; }
  .text { min-width: 0; }
  .id { font-size: 13pt; font-weight: 700; letter-spacing: 0.02em; white-space: nowrap; }
  .where { font-size: 7.5pt; color: #333; margin-top: 1mm; }
  .cta { font-size: 7pt; font-weight: 600; margin-top: 1.5mm; }
  @media print {
    body { background: #fff; }
    .toolbar { display: none; }
    .sheet { margin: 0; padding: 0; width: auto; }
    .label { outline: none; }
  }
  @media screen and (max-width: 230mm) {
    .sheet { width: auto; grid-template-columns: repeat(auto-fill, minmax(63.5mm, 1fr)); padding: 8px; }
  }
</style>
</head>
<body>
<div class="toolbar">
  <div style="flex:1;min-width:200px">
    <h1>${esc(buildingName)}: ${seats.length} desk label${seats.length === 1 ? '' : 's'}</h1>
    <p>QR codes open ${esc(baseUrl.replace(/\/+$/, ''))}/checkin?seat=&lt;desk&gt;</p>
  </div>
  <button type="button" onclick="print()">Print</button>
</div>
<div class="sheet">
${labels}
</div>
</body>
</html>
`;
}
