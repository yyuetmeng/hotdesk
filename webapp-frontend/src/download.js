// Download a file the backend generates (e.g. an Excel export), with the signed-in user's token.
import { apiUrl, readFlaskToken } from './api.js';

export async function downloadFile(path, fallbackName) {
  const res = await fetch(apiUrl(path), { headers: { authorization: `Bearer ${readFlaskToken()}` } });
  if (!res.ok) throw new Error(res.status === 403 ? 'Administrators only.' : 'The export could not be made.');
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
