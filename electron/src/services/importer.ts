import { ipcMain, dialog } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { exec } from 'node:child_process';
import TurndownService from 'turndown';
import { formatAppleNoteToMarkdown } from '../../ipc-utils.js';
import { logEvent, newRequestId } from '../../structured-log.js';
import type { FullTextSearchReadModel } from '../../fulltext-index.js';

export function importVaultRecursive(srcRoot: string, srcDir: string, destRoot: string): number {
  let imported = 0;
  if (!fs.existsSync(srcDir)) return 0;
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    if (entry.name.startsWith('.')) continue; // ignore hidden folders

    if (entry.isDirectory()) {
      imported += importVaultRecursive(srcRoot, srcPath, destRoot);
    } else {
      const ext = path.extname(entry.name).toLowerCase();
      const isMarkdown = ext === '.md';
      const isMedia = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.pdf'].includes(ext);
      if (!isMarkdown && !isMedia) continue;

      const relPath = path.relative(srcRoot, srcPath);
      const dirName = path.dirname(relPath);
      
      let destPath: string;
      if (dirName === '.') {
        destPath = path.join(destRoot, entry.name);
      } else {
        // Flatten folder structure to 1-level of folder (e.g. "Folder-Subfolder")
        const flattenedFolder = dirName
          .replace(/[/\\]/g, '-')
          // eslint-disable-next-line no-control-regex
          .replace(/[\x00-\x1F\x7F\\/:*?"<>|;`$]/g, '')
          .trim();
        const folderPath = path.join(destRoot, flattenedFolder);
        if (!fs.existsSync(folderPath)) {
          fs.mkdirSync(folderPath, { recursive: true });
        }
        destPath = path.join(folderPath, entry.name);
      }

      if (!fs.existsSync(destPath)) {
        fs.copyFileSync(srcPath, destPath);
        imported++;
      }
    }
  }
  return imported;
}

export function registerImporterHandlers(
  fullTextSearchIndex: FullTextSearchReadModel,
  getDefaultNotesDir: () => string
) {
  ipcMain.handle('import-vault', async (_, targetDir?: string) => {
    const reqId = newRequestId('import-vault');
    try {
      const { filePaths, canceled } = await dialog.showOpenDialog({
        title: 'Importa vault (Obsidian / Bear / cartella Markdown)',
        properties: ['openDirectory'],
      });
      if (canceled || !filePaths.length) return { success: false, error: 'Annullato' };
      const srcDir = filePaths[0];
      const dest = targetDir && fs.existsSync(targetDir) ? targetDir : getDefaultNotesDir();
      const importedCount = importVaultRecursive(srcDir, srcDir, dest);
      fullTextSearchIndex.markDirty(dest);
      logEvent('info', 'import_vault_completed', { reqId, importedCount, destDir: dest });
      return { success: true, data: importedCount };
    } catch (err) {
      logEvent('error', 'import_vault_failed', { reqId, error: (err as Error).message });
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('import-apple-notes', async (_, targetDir?: string) => {
    const reqId = newRequestId('import-apple');
    try {
      const dest = targetDir && fs.existsSync(targetDir) ? targetDir : getDefaultNotesDir();
      
      // Execute JXA script to fetch notes
      const jxaScript = `
        const notesApp = Application("Notes");
        const results = [];
        const folders = notesApp.folders();
        for (let i = 0; i < folders.length; i++) {
          const folder = folders[i];
          const folderName = folder.name();
          if (folderName === "Recently Deleted") continue;
          const notes = folder.notes();
          for (let j = 0; j < notes.length; j++) {
            const note = notes[j];
            results.push({
              folder: folderName,
              title: note.name() || "Untitled Note",
              body: note.body() || "",
              creationDate: note.creationDate() ? note.creationDate().toISOString() : null,
              modificationDate: note.modificationDate() ? note.modificationDate().toISOString() : null
            });
          }
        }
        JSON.stringify(results);
      `;

      return new Promise((resolve) => {
        const child = exec('osascript -l JavaScript', { maxBuffer: 1024 * 1024 * 100 }, (error, stdout, stderr) => {
          if (error) {
            logEvent('error', 'import_apple_exec_failed', { reqId, error: error.message || stderr });
            resolve({ success: false, error: error.message || stderr });
            return;
          }

          try {
            const rawNotes = JSON.parse(stdout) as {
              folder: string;
              title: string;
              body: string;
              creationDate: string | null;
              modificationDate: string | null;
            }[];

            /* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/prefer-for-of */
            const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });

            // Add span rule to format rich text styles (bold, italic, strikethrough, underline)
            turndown.addRule('span', {
              filter: 'span',
              replacement: function (content, node: any) {
                let result = content;
                const style = node.getAttribute('style') || '';
                
                // Bold
                if (style.includes('font-weight: bold') || style.includes('font-weight:bold') || style.includes('font-weight: 700') || style.includes('font-weight:700')) {
                  result = '**' + result + '**';
                }
                // Italic
                if (style.includes('font-style: italic') || style.includes('font-style:italic')) {
                  result = '*' + result + '*';
                }
                // Strikethrough
                if (style.includes('text-decoration: line-through') || style.includes('text-decoration:line-through')) {
                  result = '~~' + result + '~~';
                }
                // Underline
                if (style.includes('text-decoration: underline') || style.includes('text-decoration:underline')) {
                  result = '<u>' + result + '</u>';
                }
                
                return result;
              }
            });

            // Add div rule to handle single line breaks instead of double newlines
            turndown.addRule('div', {
              filter: 'div',
              replacement: function (content, node: any) {
                // Avoid adding extra linebreaks inside list items, pre, code, blockquotes
                let parent = node.parentNode;
                while (parent) {
                  const tag = parent.nodeName?.toLowerCase();
                  if (tag === 'li' || tag === 'pre' || tag === 'code' || tag === 'blockquote') {
                    return content;
                  }
                  parent = parent.parentNode;
                }
                return '\n' + content + '\n';
              }
            });

            // Add table rules to support Markdown table imports
            turndown.addRule('table', {
              filter: 'table',
              replacement: function (content) {
                const cleanContent = content.split('\n').filter((line: string) => line.trim() !== '').join('\n');
                return '\n\n' + cleanContent + '\n\n';
              }
            });

            turndown.addRule('thead-tbody-tfoot', {
              filter: ['thead', 'tbody', 'tfoot'],
              replacement: function (content) {
                return content;
              }
            });

            turndown.addRule('tr', {
              filter: 'tr',
              replacement: function (content, node: any) {
                let tableNode = node;
                while (tableNode && tableNode.nodeName?.toUpperCase() !== 'TABLE') {
                  tableNode = tableNode.parentNode;
                }
                
                function getTrElements(element: any) {
                  const trs: any[] = [];
                  function traverse(n: any) {
                    if (n.nodeName?.toUpperCase() === 'TR') {
                      trs.push(n);
                    } else if (n.childNodes) {
                      for (let i = 0; i < n.childNodes.length; i++) {
                        traverse(n.childNodes[i]);
                      }
                    }
                  }
                  traverse(element);
                  return trs;
                }
                
                function hasThDirectChild(trNode: any) {
                  if (!trNode.childNodes) return false;
                  for (let i = 0; i < trNode.childNodes.length; i++) {
                    if (trNode.childNodes[i].nodeName?.toUpperCase() === 'TH') {
                      return true;
                    }
                  }
                  return false;
                }
                
                function getCellCount(trNode: any) {
                  let count = 0;
                  if (!trNode.childNodes) return 0;
                  for (let i = 0; i < trNode.childNodes.length; i++) {
                    const name = trNode.childNodes[i].nodeName?.toUpperCase();
                    if (name === 'TH' || name === 'TD') {
                      count++;
                    }
                  }
                  return count;
                }

                const allRows = tableNode ? getTrElements(tableNode) : [];
                const isFirstRow = allRows[0] === node;
                const hasTh = hasThDirectChild(node);
                const isHeader = hasTh || (isFirstRow && !hasTh);

                let separator = '';
                if (isHeader) {
                  const cellCount = getCellCount(node);
                  separator = '\n|' + Array(cellCount).fill(' --- ').join('|') + '|';
                }
                return '\n|' + content + separator;
              }
            });

            turndown.addRule('td-or-th', {
              filter: ['td', 'th'],
              replacement: function (content) {
                const cleanContent = content.trim().replace(/\n/g, ' ').replace(/\|/g, '\\|');
                return ' ' + cleanContent + ' |';
              }
            });

            let imported = 0;

            for (const note of rawNotes) {
              // Clean up the note title for file name (aligning with validateFileName character set)
              let fileName = note.title
                .replace(/[\\/:*?"<>|;`$]/g, '-')
                // eslint-disable-next-line no-control-regex
                .replace(/[\x00-\x1F\x7F]/g, '')
                .trim();
              if (!fileName) fileName = 'Untitled Note';
              
              // Keep folder structure (1-level limit in Noted, aligning with validateFolderName character set)
              let folderName = note.folder
                .replace(/[\\/:*?"<>|;`$]/g, '-')
                // eslint-disable-next-line no-control-regex
                .replace(/[\x00-\x1F\x7F]/g, '')
                .trim();
              // A bare '.'/'..' segment would escape the destination via
              // path.join — drop it so imports can never write above dest.
              if (folderName === '.' || folderName === '..') folderName = '';

              let destPath = '';
              if (folderName && folderName !== 'Notes') {
                const folderPath = path.join(dest, folderName);
                if (!fs.existsSync(folderPath)) {
                  fs.mkdirSync(folderPath, { recursive: true });
                }
                destPath = path.join(folderPath, `${fileName}.md`);
              } else {
                destPath = path.join(dest, `${fileName}.md`);
              }

              // If file already exists, make filename unique (e.g. "Note_1.md")
              let finalDestPath = destPath;
              let counter = 1;
              const ext = '.md';
              const baseDir = path.dirname(destPath);
              const baseName = path.basename(destPath, ext);
              
              while (fs.existsSync(finalDestPath)) {
                finalDestPath = path.join(baseDir, `${baseName}_${counter}${ext}`);
                counter++;
              }

              const fm = formatAppleNoteToMarkdown(
                note.title,
                note.body,
                note.creationDate,
                note.modificationDate,
                turndown
              );

              fs.writeFileSync(finalDestPath, fm, 'utf-8');
              imported++;
            }
            /* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/prefer-for-of */

            fullTextSearchIndex.markDirty(dest);
            logEvent('info', 'import_apple_completed', { reqId, imported, destDir: dest });
            resolve({ success: true, data: imported });
          } catch (err) {
            logEvent('error', 'import_apple_parse_failed', { reqId, error: (err as Error).message });
            resolve({ success: false, error: `Parse error: ${(err as Error).message}` });
          }
        });

        child.stdin?.write(jxaScript);
        child.stdin?.end();
      });
    } catch (err) {
      logEvent('error', 'import_apple_failed', { reqId, error: (err as Error).message });
      return { success: false, error: (err as Error).message };
    }
  });
}
