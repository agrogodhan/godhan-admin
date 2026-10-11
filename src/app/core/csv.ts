// Minimal RFC-4180 CSV reader (quoted fields, doubled quotes, CRLF, BOM).
export function parseCsv(text: string): Array<Record<string, string>> {
  const recs: string[][] = [];
  let field = '';
  let row: string[] = [];
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field.replace(/\r$/, '')); field = ''; recs.push(row); row = []; }
    else field += c;
  }
  if (field !== '' || row.length) { row.push(field.replace(/\r$/, '')); recs.push(row); }
  const head = (recs.shift() ?? []).map((h) => h.trim());
  return recs
    .map((r, n) => ({ r, line: n + 2 }))
    .filter(({ r }) => r.some((v) => v.trim() !== ''))
    .map(({ r, line }) => ({ ...Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])), __line: line as unknown as string }));
}
