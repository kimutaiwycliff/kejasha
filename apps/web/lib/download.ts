import { API_URL } from './api';
import { toastError } from './hooks';

/** Save an API-served file (CSV exports, PDFs); the request needs the session cookie. */
export async function downloadFile(path: string, filename: string) {
  try {
    const res = await fetch(`${API_URL}${path}`, { credentials: 'include' });
    if (!res.ok) throw new Error(`Could not download (${res.status})`);
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  } catch (e) {
    toastError(e);
  }
}
