// 简单健壮的 CSV 解析（Sprint 5 T5.2）
// 正确处理：引号包裹的字段（含逗号/换行/双引号转义）、BOM、\r\n 行尾。
// 不依赖第三方库，纯状态机。

export interface CsvParseResult {
  headers: string[];
  rows: Record<string, string>[];
}

export function parseCsv(text: string): CsvParseResult {
  const src = (text ?? '').replace(/^\uFEFF/, ''); // 去 BOM
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  while (i < src.length) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      row.push(field);
      field = '';
      i += 1;
      continue;
    }
    if (ch === '\n' || ch === '\r') {
      // \r\n 合并为一个行尾
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  // 末尾字段
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // 去掉全空行
  const nonEmpty = rows.filter((r) => r.some((c) => c.trim() !== ''));
  if (nonEmpty.length === 0) return { headers: [], rows: [] };

  const headers = nonEmpty[0].map((h) => h.trim());
  const data = nonEmpty.slice(1).map((r) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      if (h) obj[h] = (r[idx] ?? '').trim();
    });
    return obj;
  });
  return { headers, rows: data };
}

/** 行转 CSV 文本（导出用） */
export function toCsv(
  headers: string[],
  rows: Array<Record<string, string>>,
): string {
  const escape = (v: string) => {
    const s = v ?? '';
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.map(escape).join(',')];
  for (const r of rows) {
    lines.push(headers.map((h) => escape(r[h] ?? '')).join(','));
  }
  return lines.join('\n');
}
