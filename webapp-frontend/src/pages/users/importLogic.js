// Bulk import of users / project teams (owner 2026-10-16): wording for the preview and the result.
const STATUS = { create: 'New', update: 'Add to team', skip: 'Skipped', error: 'Error' };
export const statusLabel = (status) => STATUS[status] ?? status;

const noun = (kind, n) => (kind === 'users' ? `user${n === 1 ? '' : 's'}` : `project team${n === 1 ? '' : 's'}`);
const toImport = (summary) => (summary.create ?? 0) + (summary.update ?? 0);

export function importLabel(kind, summary) {
  const n = toImport(summary);
  return n ? `Import ${n} ${noun(kind, n)}` : 'Nothing to import';
}

export function resultText(kind, imported, summary) {
  const parts = [`Imported ${imported} ${noun(kind, imported)}.`];
  if (summary.skip) parts.push(`${summary.skip} skipped (already there)${summary.error ? ',' : '.'}`);
  if (summary.error) parts.push(`${summary.error} with errors not imported.`);
  return parts.join(' ');
}
