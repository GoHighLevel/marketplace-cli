/* Minimal column renderer — keeps output grep-friendly with no extra deps. */
export function renderTable(headers: string[], rows: string[][]): string {
  const clean = (value: string) =>
    value
      .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '')
      .replace(/[\u0000-\u001F\u007F-\u009F]+/g, ' ')
      .trim()
  const safeHeaders = headers.map(clean)
  const safeRows = rows.map(row => row.map(clean))
  const widths = safeHeaders.map((header, i) => Math.max(header.length, ...safeRows.map(row => (row[i] ?? '').length)))
  const renderRow = (cells: string[]) => cells.map((cell, i) => (cell ?? '').padEnd(widths[i])).join('  ')
  return [renderRow(safeHeaders), ...safeRows.map(renderRow)].join('\n')
}
