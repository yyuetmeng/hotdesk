// Upload Users (owner 2026-10-16): wording for the preview and the result.
const STATUS = { create: 'New', skip: 'Skipped', error: 'Error' };
export const statusLabel = (status) => STATUS[status] ?? status;

const users = (n) => `user${n === 1 ? '' : 's'}`;

export const importLabel = (summary) => (summary.create ? `Upload ${summary.create} ${users(summary.create)}` : 'Nothing to upload');

export function resultText(uploaded, summary) {
  const parts = [`Uploaded ${uploaded} ${users(uploaded)}.`];
  if (summary.skip) parts.push(`${summary.skip} skipped (already there)${summary.error ? ',' : '.'}`);
  if (summary.error) parts.push(`${summary.error} with errors not uploaded.`);
  return parts.join(' ');
}
