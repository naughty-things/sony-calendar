// Convert an HTML <table> to markdown, respecting rowspan/colspan.
// This is critical for planning-table emails like Cheri's MSS Workshop
// forwards — the row that contains the "Request Date" cell with
// rowspan="5" must visually extend into all 5 post rows, or the AI
// will misalign column headers and pick the wrong dates.
//
// Example that motivated this:
//   Header: Post | Request Date | Target Launch Date | Cate. | Format | ...
//   Post 1: 1    | 10 Jun       | 16 Jun             | My Sony Studio | ...
//   Post 2: 2    | <rowspan>    | 19 Jun             | My Sony Studio | ...
//   ...
// Naive markdown rendering collapses the rowspan and the AI reads "19 Jun"
// as the Request Date for post 2, when it's actually the Target Launch Date.

export function htmlTableToMarkdown(tableHtml: string): string {
  // Strip style/script tags so they don't confuse the cell extractor
  tableHtml = tableHtml.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  tableHtml = tableHtml.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');

  // Extract rows
  type Cell = { text: string; colspan: number; rowspan: number };
  const rows: Cell[][] = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let trMatch;
  while ((trMatch = trRe.exec(tableHtml)) !== null) {
    const cells: Cell[] = [];
    const tdRe = /<t[dh]([^>]*)>([\s\S]*?)<\/t[dh]>/gi;
    let tdMatch;
    while ((tdMatch = tdRe.exec(trMatch[1])) !== null) {
      const attrs = tdMatch[1];
      const colspan = parseInt((attrs.match(/colspan="(\d+)"/) || [])[1] || '1', 10);
      const rowspan = parseInt((attrs.match(/rowspan="(\d+)"/) || [])[1] || '1', 10);
      const text = cleanCellText(tdMatch[2]);
      cells.push({ text, colspan, rowspan });
    }
    rows.push(cells);
  }
  if (rows.length === 0) return '';

  // Determine total columns by spreading each row's cells
  const numCols = Math.max(...rows.map(r => r.reduce((s, c) => s + c.colspan, 0)));

  // Build a grid[row][col] = text, filling gaps from prior rowspan cells
  const grid: string[][] = [];
  for (let i = 0; i < rows.length; i++) {
    grid[i] = new Array(numCols).fill('');
  }
  // Track active rowspan extensions by column
  const span: ({ remaining: number; text: string } | null)[] = new Array(numCols).fill(null);

  for (let r = 0; r < rows.length; r++) {
    let col = 0;
    let cellIdx = 0;
    while (col < numCols) {
      const activeSpan = span[col];
      if (activeSpan) {
        grid[r][col] = activeSpan.text;
        activeSpan.remaining--;
        if (activeSpan.remaining <= 0) span[col] = null;
        col++;
      } else {
        if (cellIdx < rows[r].length) {
          const cell = rows[r][cellIdx];
          // Place this cell at column `col`, fill colspan with the same text
          for (let k = 0; k < cell.colspan; k++) {
            grid[r][col + k] = cell.text;
            if (cell.rowspan > 1) {
              span[col + k] = { remaining: cell.rowspan - 1, text: cell.text };
            }
          }
          col += cell.colspan;
          cellIdx++;
        } else {
          // No cell to place — leave blank
          col++;
        }
      }
    }
  }

  // Render as markdown
  const escape = (s: string) =>
    s
      .replace(/\|/g, '\\|')
      .replace(/\r?\n/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  const truncate = (s: string, max = 200) => (s.length > max ? s.slice(0, max - 1) + '…' : s);

  const md: string[] = [];
  md.push('| ' + grid[0].map(escape).join(' | ') + ' |');
  md.push('| ' + grid[0].map(() => '---').join(' | ') + ' |');
  for (let r = 1; r < grid.length; r++) {
    md.push('| ' + grid[r].map(c => truncate(escape(c))).join(' | ') + ' |');
  }
  return md.join('\n');
}

/**
 * Extract every <table>...</table> block from an HTML string and convert
 * each to markdown. Returns an array of {startIndex, md} so callers can
 * splice back into the body in place.
 */
export function htmlTablesToMarkdown(html: string): { startIndex: number; endIndex: number; md: string }[] {
  const results: { startIndex: number; endIndex: number; md: string }[] = [];
  const tableRe = /<table[^>]*>[\s\S]*?<\/table>/gi;
  let m;
  while ((m = tableRe.exec(html)) !== null) {
    const md = htmlTableToMarkdown(m[0]);
    if (md) {
      results.push({ startIndex: m.index, endIndex: m.index + m[0].length, md });
    }
  }
  return results;
}

function cleanCellText(raw: string): string {
  return raw
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/p>/gi, ' ')
    .replace(/<p[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}