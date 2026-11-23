export type TableDelimiter = '\t' | ',' | ';' | '|';

const DELIMITERS: TableDelimiter[] = ['\t', '|', ';', ','];

function nonEmptyLines(text: string): string[] {
  return text.split(/\r?\n/).filter((line) => line.trim() !== '');
}

function padRows(rows: string[][]): string[][] {
  const width = Math.max(0, ...rows.map((row) => row.length));
  return rows.map((row) => [...row, ...Array<string>(width - row.length).fill('')]);
}

/** Picks the delimiter occurring most often in the text; ties favor the earlier of tab, pipe, semicolon, comma; falls back to comma. */
export function detectDelimiter(text: string): TableDelimiter {
  let best: TableDelimiter = ',';
  let bestCount = 0;
  for (const delimiter of DELIMITERS) {
    const count = text.split(delimiter).length - 1;
    if (count > bestCount) {
      best = delimiter;
      bestCount = count;
    }
  }
  return best;
}

/** Splits text into trimmed cells, padding ragged rows to the widest row. Pipe tables may have outer pipes. */
export function parseTextTable(text: string, delimiter: TableDelimiter = detectDelimiter(text)): string[][] {
  const rows = nonEmptyLines(text).map((line) => {
    let cells = line.split(delimiter).map((cell) => cell.trim());
    if (delimiter === '|') {
      if (cells.length > 1 && cells[0] === '') cells = cells.slice(1);
      if (cells.length > 1 && cells[cells.length - 1] === '') cells = cells.slice(0, -1);
    }
    return cells;
  });
  return padRows(rows);
}

/** Renders rows as a GFM table, treating the first row as the header. */
export function toMarkdownTable(rows: string[][]): string {
  if (rows.length === 0) return '';
  const padded = padRows(rows);
  const renderRow = (row: string[]) => `| ${row.map((cell) => cell.replace(/\|/g, '\\|')).join(' | ')} |`;
  const separator = `| ${padded[0].map(() => '---').join(' | ')} |`;
  return [renderRow(padded[0]), separator, ...padded.slice(1).map(renderRow)].join('\n');
}

/** Joins rows with the delimiter (tab by default), one row per line. */
export function toDelimitedText(rows: string[][], delimiter: TableDelimiter = '\t'): string {
  return rows.map((row) => row.join(delimiter)).join('\n');
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Renders rows as an HTML table (first row as `<th>`) suitable for TipTap `insertContent`. */
export function tableDataToHtml(rows: string[][]): string {
  if (rows.length === 0) return '';
  const padded = padRows(rows);
  const head = `<thead><tr>${padded[0].map((c) => `<th>${escapeHtml(c)}</th>`).join('')}</tr></thead>`;
  const bodyRows = padded.slice(1).map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`).join('');
  return `<table>${head}<tbody>${bodyRows}</tbody></table>`;
}
