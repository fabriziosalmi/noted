import { BrowserWindow, ipcMain, dialog } from 'electron';
import fs from 'node:fs';
import { stripUnsafeHtml } from '../../ipc-utils.js';
import { logEvent } from '../../structured-log.js';
import { tr } from '../../core/language.js';

/** A closed Save dialog: not a failure, so the app says nothing. */
const CANCELED = { success: false, canceled: true } as const;

/** The name the Save dialog suggests: the note's title (its last path segment), without characters a file name cannot hold. */
export function exportFileName(title: unknown, ext: string): string {
  const base = typeof title === 'string'
    // eslint-disable-next-line no-control-regex
    ? (title.split('/').pop() ?? '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').trim()
    : '';
  return `${base || 'Note'}.${ext}`;
}

const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const DOCX_IMAGE_TYPES: { mime: string; magic: number[] }[] = [
  { mime: 'image/png', magic: [0x89, 0x50, 0x4e, 0x47] },
  { mime: 'image/jpeg', magic: [0xff, 0xd8, 0xff] },
  { mime: 'image/gif', magic: [0x47, 0x49, 0x46, 0x38] },
];

// An attribute value as serialized HTML already has its & and " as entities; only < and > can be raw in it.
const attrToText = (s: string): string => s.replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * The images html-to-docx may see: embedded PNG, JPEG and GIF, recognised by their first bytes, not by the label. It
 * carries its own copy of image-size 1.x, whose ICNS and HEIF readers loop for ever on crafted files (GHSA-w3rx-r6r6-pgpr,
 * GHSA-5p2g-fcmc-qvqq), and it would fetch an image given by address. Any other image is replaced by its alt text.
 */
export function docxSafeImages(html: string): string {
  // A quoted attribute value may hold a ">", so the tag ends at the first ">" outside quotes.
  return html.replace(/<img\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi, tag => {
    const src = /\ssrc\s*=\s*"([^"]*)"/i.exec(tag)?.[1] ?? /\ssrc\s*=\s*'([^']*)'/i.exec(tag)?.[1] ?? '';
    const data = /^data:(image\/[a-z+.-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(src);
    if (data) {
      const head = Buffer.from(data[2].slice(0, 16), 'base64');
      const type = DOCX_IMAGE_TYPES.find(t => t.mime === data[1].toLowerCase());
      if (type && type.magic.every((b, k) => head[k] === b)) return tag;
    }
    const alt = /\salt\s*=\s*"([^"]*)"/i.exec(tag)?.[1] ?? '';
    return alt ? `<span>${attrToText(alt)}</span>` : '';
  });
}

export function registerExporterHandlers() {
  ipcMain.handle('export-markdown', async (_, markdownContent: string, noteTitle?: string) => {
    try {
      if (typeof markdownContent !== 'string') throw new Error('Content must be a string');
      const { filePath } = await dialog.showSaveDialog({
        title: tr('dlgExportMarkdown'),
        defaultPath: exportFileName(noteTitle, 'md'),
        filters: [{ name: 'Markdown', extensions: ['md'] }],
      });
      if (!filePath) return CANCELED;
      fs.writeFileSync(filePath, markdownContent, 'utf-8');
      return { success: true, data: filePath };
    } catch (error: unknown) {
      const err = error as Error;
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('export-pdf', async (_event, htmlContent: string, noteTitle?: string) => {
    try {
      if (typeof htmlContent !== 'string') throw new Error('htmlContent must be a string');
      if (htmlContent.length > 5_000_000) throw new Error(tr('errPdfTooLarge'));
      // Show save dialog
      const { filePath } = await dialog.showSaveDialog({
        title: tr('dlgExportPdf'),
        defaultPath: exportFileName(noteTitle, 'pdf'),
        filters: [{ name: 'PDF', extensions: ['pdf'] }]
      });

      if (!filePath) return CANCELED;

      // Create a hidden browser window to render the HTML
      const pdfWin = new BrowserWindow({
        show: false,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true
        }
      });

      try {
        const safeContent = stripUnsafeHtml(htmlContent);
        const styledHtml = `
          <!DOCTYPE html>
          <html>
            <head>
              <meta charset="utf-8">
              <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
              <style>
                body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; padding: 40px; line-height: 1.6; color: #333; }
                h1, h2, h3 { color: #111; }
                code { background-color: #f4f4f4; padding: 2px 4px; border-radius: 4px; font-family: monospace; }
                pre { background-color: #f4f4f4; padding: 16px; border-radius: 8px; overflow-x: auto; }
                blockquote { border-left: 4px solid #ddd; padding-left: 16px; color: #666; }
                img { max-width: 100%; height: auto; border-radius: 8px; }
              </style>
            </head>
            <body>
              ${safeContent}
            </body>
          </html>
        `;

        await pdfWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(styledHtml)}`);

        const pdfBuffer = await pdfWin.webContents.printToPDF({
          printBackground: true,
          // Electron's current typings dropped marginType; kept as is (no behaviour change).
          margins: { marginType: 'printableArea' } as Electron.PrintToPDFMargins,
        });

        fs.writeFileSync(filePath, pdfBuffer);
        return { success: true, data: filePath };
      } finally {
        pdfWin.close();
      }
    } catch (error: unknown) {
      const err = error as Error;
      logEvent('error', 'export_pdf_failed', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('print-note', async (_event, htmlContent: string, title?: string) => {
    try {
      if (typeof htmlContent !== 'string') throw new Error('htmlContent must be a string');
      if (htmlContent.length > 5_000_000) throw new Error(tr('errPrintTooLarge'));

      const printWin = new BrowserWindow({
        show: false,
        webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true }
      });

      try {
        const safeContent = stripUnsafeHtml(htmlContent);
        const safeTitle = (title ?? 'Nota').replace(/[<>]/g, '');
        const styledHtml = `
          <!DOCTYPE html>
          <html>
            <head>
              <meta charset="utf-8">
              <title>${safeTitle}</title>
              <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
              <style>
                body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; padding: 40px; line-height: 1.6; color: #222; }
                h1, h2, h3 { color: #111; }
                code { background-color: #f4f4f4; padding: 2px 4px; border-radius: 4px; font-family: monospace; }
                pre { background-color: #f4f4f4; padding: 16px; border-radius: 8px; overflow-x: auto; }
                blockquote { border-left: 4px solid #ddd; padding-left: 16px; color: #555; }
                img { max-width: 100%; height: auto; }
                table { border-collapse: collapse; }
                th, td { border: 1px solid #ccc; padding: 4px 8px; }
              </style>
            </head>
            <body>${safeContent}</body>
          </html>
        `;

        await printWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(styledHtml)}`);

        await new Promise<void>((resolve, reject) => {
          printWin.webContents.print(
            { silent: false, printBackground: true },
            (success, failureReason) => {
              if (!success && failureReason && failureReason !== 'cancelled') {
                reject(new Error(failureReason));
              } else {
                resolve();
              }
            }
          );
        });

        return { success: true };
      } finally {
        printWin.close();
      }
    } catch (error: unknown) {
      const err = error as Error;
      logEvent('error', 'print_note_failed', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('export-html', async (_, htmlContent: string, noteTitle: string) => {
    try {
      if (typeof htmlContent !== 'string') throw new Error('htmlContent must be a string');
      const { filePath } = await dialog.showSaveDialog({
        title: tr('dlgExportHtml'),
        defaultPath: exportFileName(noteTitle, 'html'),
        filters: [{ name: 'HTML', extensions: ['html'] }],
      });
      if (!filePath) return CANCELED;
      const safe = stripUnsafeHtml(htmlContent);
      const full = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(String(noteTitle ?? ''))}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif; max-width: 800px; margin: 60px auto; padding: 0 24px; line-height: 1.7; color: #1a1a1a; }
    h1,h2,h3 { font-weight: 700; margin-top: 1.5em; }
    code { background: #f3f4f6; padding: 2px 5px; border-radius: 4px; font-family: monospace; }
    pre { background: #f3f4f6; padding: 1em; border-radius: 8px; overflow-x: auto; }
    img { max-width: 100%; border-radius: 8px; }
    blockquote { border-left: 4px solid #e5e7eb; padding-left: 1em; color: #6b7280; }
    table { border-collapse: collapse; width: 100%; }
    td,th { border: 1px solid #e5e7eb; padding: 8px 12px; }
    th { background: #f9fafb; font-weight: 600; }
  </style>
</head>
<body>${safe}</body>
</html>`;
      fs.writeFileSync(filePath, full, 'utf-8');
      return { success: true, data: filePath };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('export-docx', async (_, htmlContent: string, noteTitle: string) => {
    try {
      if (typeof htmlContent !== 'string') throw new Error('htmlContent must be a string');
      const { filePath } = await dialog.showSaveDialog({
        title: tr('dlgExportDocx'),
        defaultPath: exportFileName(noteTitle, 'docx'),
        filters: [{ name: tr('dlgFilterWord'), extensions: ['docx'] }],
      });
      if (!filePath) return CANCELED;

      const safe = docxSafeImages(stripUnsafeHtml(htmlContent));
      // Dynamic import — html-to-docx is CJS
      const { default: HTMLtoDOCX } = await import('html-to-docx') as { default: (html: string, header: null, opts: object) => Promise<Buffer> };
      const buf = await HTMLtoDOCX(
        `<!DOCTYPE html><html><body>${safe}</body></html>`,
        null,
        { title: noteTitle, font: 'Helvetica Neue', fontSize: 24, table: { row: { cantSplit: true } } }
      );
      fs.writeFileSync(filePath, buf);
      return { success: true, data: filePath };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });
}
