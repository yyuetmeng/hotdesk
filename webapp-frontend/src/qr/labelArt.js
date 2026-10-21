// Desk label artwork (owner picked "chair icon in the centre", 2026-10-20): rounded modules, rounded corner squares
// and a desk-chair glyph in a cleared centre. Built as SVG text so the preview and the PNG are the same drawing.
// The code uses error correction H, which rebuilds the modules under the chair; keep the centre under ~10% of the area.
import QRCode from 'qrcode';

const INK = '#0f172a', PAPER = '#ffffff', QUIET = 4;   // QUIET: blank modules around the code (scanners want 4)

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** The QR modules for a link: { size, dark(row, col) }. */
export function qrMatrix(text) {
  const { modules } = QRCode.create(text, { errorCorrectionLevel: 'H' });
  return { size: modules.size, dark: (r, c) => Boolean(modules.get(r, c)) };
}

/** Side of the cleared centre, in modules: odd (so it sits exactly in the middle of an odd-sized code), just under 30% of the side. */
export function centreSize(size) {
  const k = Math.floor(size * 0.3);
  return k % 2 ? k : k - 1;
}

const chair = (k) => {     // a desk chair drawn on a 24-unit grid, scaled to k modules
  const s = k / 24;
  return `<rect width="${k}" height="${k}" rx="${k * 0.22}" fill="${PAPER}"/>`
    + `<g transform="scale(${s})" fill="none" stroke="${INK}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">`
    + '<path d="M8 4h8a1 1 0 0 1 1 1v7H7V5a1 1 0 0 1 1-1z"/><path d="M5 12h14v2.5H5z"/><path d="M12 14.5V19M8 20h8M8 20l-1 1.5M16 20l1 1.5"/></g>';
};

/** The code alone as an <svg>, quiet zone included; `px` sets width and height. */
export function codeSvg(m, px) {
  const n = m.size, k = centreSize(n), k0 = (n - k) / 2;
  const finder = (r, c) => (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);
  const centre = (r, c) => r >= k0 && r < k0 + k && c >= k0 && c < k0 + k;
  let cells = '';
  for (let r = 0; r < n; r += 1) for (let c = 0; c < n; c += 1) {
    if (m.dark(r, c) && !finder(r, c) && !centre(r, c)) cells += `<rect x="${c + 0.06}" y="${r + 0.06}" width=".88" height=".88" rx=".3"/>`;
  }
  const eye = (x, y) => `<rect x="${x}" y="${y}" width="7" height="7" rx="2"/><rect x="${x + 1}" y="${y + 1}" width="5" height="5" rx="1.3" fill="${PAPER}"/>`
    + `<rect x="${x + 2}" y="${y + 2}" width="3" height="3" rx=".8"/>`;
  const side = n + QUIET * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="${-QUIET} ${-QUIET} ${side} ${side}">`
    + `<rect x="${-QUIET}" y="${-QUIET}" width="${side}" height="${side}" fill="${PAPER}"/>`
    + `<g fill="${INK}">${cells}${eye(0, 0)}${eye(n - 7, 0)}${eye(0, n - 7)}</g>`
    + `<g transform="translate(${k0} ${k0})">${chair(k)}</g></svg>`;
}

export const LABEL_WIDTH = 600, LABEL_HEIGHT = 760;

/** 60px for short seat labels, smaller for long ones so they fit the 540px line (bold Inter averages ~0.62em a character). */
export const labelFontSize = (label) => Math.max(24, Math.min(60, Math.floor(540 / (Math.max(String(label).length, 1) * 0.62))));

/** A whole printable label: the code, the seat label large underneath, the place, and "Scan to check in". */
export function labelSvg(m, { label, place }) {
  const W = LABEL_WIDTH, code = 540, font = 'Inter, Segoe UI, system-ui, sans-serif';
  const inner = codeSvg(m, code).replace('<svg xmlns="http://www.w3.org/2000/svg"', `<svg x="${(W - code) / 2}" y="10"`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${LABEL_HEIGHT}" viewBox="0 0 ${W} ${LABEL_HEIGHT}">`
    + `<rect width="${W}" height="${LABEL_HEIGHT}" fill="${PAPER}"/>${inner}`
    + `<g text-anchor="middle" font-family="${font}">`
    + `<text x="${W / 2}" y="618" font-size="${labelFontSize(label)}" font-weight="800" fill="${INK}">${esc(label)}</text>`
    + `<text x="${W / 2}" y="668" font-size="26" fill="#475569">${esc(place)}</text>`
    + `<text x="${W / 2}" y="722" font-size="24" font-weight="700" letter-spacing="4" fill="${INK}">SCAN TO CHECK IN</text></g></svg>`;
}
