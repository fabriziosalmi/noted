import { BrowserWindow, ipcMain, dialog } from 'electron';
import fs from 'node:fs';
import { stripUnsafeHtml } from '../../ipc-utils.js';
import { logEvent } from '../../structured-log.js';

export function registerExporterHandlers() {
  ipcMain.handle('export-markdown', async (_, markdownContent: string) => {
    try {
      if (typeof markdownContent !== 'string') throw new Error('Content must be a string');
      const { filePath } = await dialog.showSaveDialog({
        title: 'Esporta come Markdown',
        defaultPath: 'Nota.md',
        filters: [{ name: 'Markdown', extensions: ['md'] }],
      });
      if (!filePath) return { success: false, error: 'Esportazione annullata' };
      fs.writeFileSync(filePath, markdownContent, 'utf-8');
      return { success: true, data: filePath };
    } catch (error: unknown) {
      const err = error as Error;
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('export-pdf', async (event, htmlContent: string) => {
    try {
      if (typeof htmlContent !== 'string') throw new Error('htmlContent must be a string');
      if (htmlContent.length > 5_000_000) throw new Error('Content too large for PDF export');
      // Show save dialog
      const { filePath } = await dialog.showSaveDialog({
        title: 'Esporta come PDF',
        defaultPath: 'Nota.pdf',
        filters: [{ name: 'PDF', extensions: ['pdf'] }]
      });

      if (!filePath) {
        return { success: false, error: 'Esportazione annullata' };
      }

      // Create a hidden browser window to render the HTML
      const pdfWin = new BrowserWindow({
        show: false,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true
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
          margins: { marginType: 'printableArea' }
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
      if (htmlContent.length > 5_000_000) throw new Error('Content too large to print');

      const printWin = new BrowserWindow({
        show: false,
        webPreferences: { nodeIntegration: false, contextIsolation: true }
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
        title: 'Esporta come HTML',
        defaultPath: `${noteTitle || 'Nota'}.html`,
        filters: [{ name: 'HTML', extensions: ['html'] }],
      });
      if (!filePath) return { success: false, error: 'Esportazione annullata' };
      const safe = stripUnsafeHtml(htmlContent);
      const full = `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${noteTitle}</title>
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
        title: 'Esporta come DOCX',
        defaultPath: `${noteTitle || 'Nota'}.docx`,
        filters: [{ name: 'Word Document', extensions: ['docx'] }],
      });
      if (!filePath) return { success: false, error: 'Esportazione annullata' };

      const safe = stripUnsafeHtml(htmlContent);
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
