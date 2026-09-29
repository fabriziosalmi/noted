import { getElectronApi } from './electronApi';
import type { TranslationKey } from './i18n';

export interface PrintNoteDeps {
  t: (key: TranslationKey) => string;
  onToast: (msg: string, variant: 'success' | 'error') => void;
}

/**
 * Single place that knows how to print the current note.
 * - Electron: forwards the editor HTML to the main process (`print-note`),
 *   which opens the native system print dialog.
 * - Web/dev browser (no electronAPI): falls back to `window.print()`.
 * Returns true when a print was attempted.
 */
export async function printNoteFromHtml(
  html: string,
  title: string,
  { t, onToast }: PrintNoteDeps,
): Promise<boolean> {
  if (!html) {
    onToast(t('noActiveNote'), 'error');
    return false;
  }
  const api = getElectronApi();
  if (!api?.printNote) {
    window.print();
    return true;
  }
  const res = await api.printNote(html, title || t('untitledExportTitle'));
  if (!res.success && res.error) {
    onToast(res.error || t('printError'), 'error');
    return false;
  }
  return true;
}
