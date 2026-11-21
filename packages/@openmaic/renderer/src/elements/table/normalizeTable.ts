import type { PPTTableElement, TableCell } from '@openmaic/dsl';

/** Read-only compatibility for model/legacy tables. Missing layout metadata
 * must not take down the classroom (including an off-screen thumbnail).
 * Keep authored cells, merge spans and valid imported widths unchanged. */
export function normalizeTable(table: PPTTableElement): PPTTableElement {
  const rows = Array.isArray(table.data) ? table.data.filter(Array.isArray) : [];
  const data: TableCell[][] = rows.map((row, r) =>
    row.map((raw, c) => {
      const cell: Partial<TableCell> =
        raw && typeof raw === 'object' ? raw : { text: typeof raw === 'string' ? raw : '' };
      return {
        ...cell,
        id: cell.id ?? `${table.id}-cell-${r}-${c}`,
        text: typeof cell.text === 'string' ? cell.text : '',
        colspan:
          typeof cell.colspan === 'number' && Number.isInteger(cell.colspan) && cell.colspan > 0
            ? cell.colspan
            : 1,
        rowspan:
          typeof cell.rowspan === 'number' && Number.isInteger(cell.rowspan) && cell.rowspan > 0
            ? cell.rowspan
            : 1,
        style: cell.style && typeof cell.style === 'object' ? cell.style : {},
      };
    }),
  );
  const validWidths = (value: unknown): value is number[] =>
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((n) => typeof n === 'number' && Number.isFinite(n) && n > 0);
  const legacyWidths = (table as PPTTableElement & { colWidthSums?: unknown }).colWidthSums;
  const columns = Math.max(
    1,
    ...data.map((row) => row.reduce((sum, cell) => sum + cell.colspan, 0)),
  );
  const colWidths = validWidths(table.colWidths)
    ? table.colWidths
    : validWidths(legacyWidths)
      ? legacyWidths
      : Array.from({ length: columns }, () => 1 / columns);
  return {
    ...table,
    data,
    colWidths,
    cellMinHeight:
      Number.isFinite(table.cellMinHeight) && table.cellMinHeight >= 0 ? table.cellMinHeight : 32,
  };
}
