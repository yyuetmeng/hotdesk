// Password policy shown as you type (owner 2026-10-16); the server applies the same rules (app/core/passwords.py):
// at least 8 characters, letters and numbers, not a well-known password (nor your username). Well-known passwords
// are known here only as SHA-256 hashes from GET /api/auth/common-password-hashes — no password text in code.

const SWAPS = { '@': 'a', '0': 'o', '1': 'l', '3': 'e', $: 's', 5: 's', '!': 'i' };
const LABELS = ['Too weak', 'Weak', 'Fair', 'Good', 'Strong'];

async function sha256Hex(text) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The hashes the server looks up for a password: lowercase, and with symbols read as letters (p@ss -> pass). */
export async function commonFormsHex(password) {
  const low = (password ?? '').toLowerCase();
  const swapped = [...low].map((ch) => SWAPS[ch] ?? ch).join('');
  return [...new Set(await Promise.all([low, swapped].map(sha256Hex)))];
}

let listing = null;
/** The well-known password hashes, fetched once per visit (a Set; empty if they cannot be loaded). */
export function loadCommonHashes(fetchJson) {
  listing ??= fetchJson('/api/auth/common-password-hashes').then((d) => new Set(d.hashes)).catch(() => new Set());
  return listing;
}

/** { ok, label, score 0-4, rules: [{ text, ok }] } for a password; `common` = it matched the well-known list. */
export function checkPassword(password, { common = false, username, email } = {}) {
  const pw = password ?? '';
  const names = [username, (email ?? '').split('@')[0]].filter(Boolean).map((n) => n.toLowerCase());
  const rules = [
    { text: 'At least 8 characters', ok: pw.length >= 8 },
    { text: 'Letters and numbers', ok: /[A-Za-z]/.test(pw) && /\d/.test(pw) },
    { text: 'Not a well-known password or your username', ok: !common && !names.includes(pw.toLowerCase()) },
  ];
  const ok = rules.every((r) => r.ok);
  const extra = (pw.length >= 12 ? 1 : 0) + ((/[a-z]/.test(pw) && /[A-Z]/.test(pw)) || /[^A-Za-z0-9]/.test(pw) ? 1 : 0);
  const score = ok ? 2 + extra : (common ? 0 : Math.min(rules.filter((r) => r.ok).length - 1, 1));
  return { ok, score: Math.max(score, 0), label: pw ? LABELS[Math.max(score, 0)] : '', rules };
}
