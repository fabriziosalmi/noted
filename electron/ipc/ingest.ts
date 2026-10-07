import { ipcMain } from 'electron';
import { fetchPage, IngestFetchError } from '../ingest-fetch';
import { extractArticle, MAX_SOURCE_CHARS } from '../ingest-extract';

export interface IngestedPage {
  /** Where the page ended up after redirects. */
  url: string;
  title: string;
  /** The readable text, as Markdown. */
  text: string;
  truncated: boolean;
}

export function registerIngestHandlers(): void {
  // The text of a web page, for a source note. The address is the person's, but the page may send us anywhere: see ingest-fetch.ts.
  ipcMain.handle('ingest-fetch', async (_, url: unknown) => {
    try {
      if (typeof url !== 'string' || url.length > 2048) throw new IngestFetchError('scheme', 'that is not a web address');
      const page = await fetchPage(url);
      if (!page.html) {
        const text = page.text.slice(0, MAX_SOURCE_CHARS);
        let host = page.url;
        try { host = new URL(page.url).hostname; } catch { /* keep the address */ }
        return { success: true, data: { url: page.url, title: host, text, truncated: page.text.length > MAX_SOURCE_CHARS } satisfies IngestedPage };
      }
      const article = await extractArticle(page.text, page.url);
      return { success: true, data: { url: page.url, title: article.title, text: article.markdown, truncated: article.truncated } satisfies IngestedPage };
    } catch (err) {
      return { success: false, error: (err as Error).message, code: err instanceof IngestFetchError ? err.code : 'network' };
    }
  });
}
