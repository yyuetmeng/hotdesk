// Colour theme: follow the system, or force light or dark. The choice is a per-browser convenience
// kept in localStorage; styles.css switches palettes on <html data-theme="dark">.

export const THEME_CHOICES = [
  { value: 'system', label: 'Follow system' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

const STORAGE_KEY = 'hotdesk.theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

/** A saved value, or 'system' when nothing (or something unknown) is stored. */
export const normalizeTheme = (value) => (THEME_CHOICES.some((c) => c.value === value) ? value : 'system');

/** The palette to show for a choice, given whether the system currently prefers dark. */
export const resolveTheme = (choice, systemDark) => (choice === 'system' ? (systemDark ? 'dark' : 'light') : choice);

export function readTheme() {
  try { return normalizeTheme(window.localStorage.getItem(STORAGE_KEY)); } catch { return 'system'; }
}

export function saveTheme(choice) {
  try { window.localStorage.setItem(STORAGE_KEY, choice); } catch { /* private mode: applies for this visit only */ }
}

const systemPrefersDark = () => Boolean(window.matchMedia?.(DARK_QUERY).matches);

export function applyTheme(choice) {
  document.documentElement.dataset.theme = resolveTheme(choice, systemPrefersDark());
}

/** Re-apply when the system theme changes; returns an unsubscribe function. */
export function watchSystemTheme(onChange) {
  const media = window.matchMedia?.(DARK_QUERY);
  if (!media) return () => {};
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}
