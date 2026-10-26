import { API_URL } from './api';
import { toastError } from './hooks';

/**
 * Open an API-served PDF (receipts, statements). The request needs the session cookie, so it is
 * fetched here and shown from a blob URL rather than linked directly.
 */
export async function openPdf(path: string) {
  // Open the tab synchronously so pop-up blockers allow it, then point it at the blob.
  const tab = window.open('', '_blank');
  try {
    const res = await fetch(`${API_URL}${path}`, { credentials: 'include' });
    if (!res.ok) throw new Error(`Could not load the document (${res.status})`);
    const url = URL.createObjectURL(await res.blob());
    if (tab) tab.location.href = url;
    else window.location.assign(url);
  } catch (e) {
    tab?.close();
    toastError(e);
  }
}
