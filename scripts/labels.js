// Writes a printable page of QR desk labels without starting the server.
// Usage: PUBLIC_URL=https://hotdesk.example.com node scripts/labels.js [output.html]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { expandLayout } from '../src/occupancy.js';
import { renderLabelsPage } from '../src/labels.js';

const baseUrl = process.env.PUBLIC_URL;
if (!baseUrl) {
  console.error('Set PUBLIC_URL to the address employees will open, e.g. PUBLIC_URL=https://hotdesk.example.com npm run labels');
  process.exit(1);
}
const buildingFile = process.env.BUILDING_FILE ?? new URL('../config/building.json', import.meta.url);
const building = JSON.parse(readFileSync(buildingFile, 'utf8'));
const out = resolve(process.argv[2] ?? 'labels/desk-labels.html');

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, renderLabelsPage({ seats: expandLayout(building), baseUrl, buildingName: building.name }));
console.log(`Wrote labels for ${expandLayout(building).length} desks to ${out}. Open it in a browser and print on A4.`);
