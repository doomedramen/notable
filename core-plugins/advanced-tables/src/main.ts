// Core Notable plugin: GFM table editing.
//
//  - Tab / Shift-Tab move between cells, creating a new row when Tab is
//    pressed in the last cell of the last row (Obsidian "Advanced Tables"
//    behavior).
//  - Enter moves to the same column on the next row, creating one if needed.
//  - Every navigation re-aligns the table's columns, so tables stay tidy
//    as you type.
//  - Command palette actions cover row/column insertion, deletion,
//    reordering, alignment, and sorting. Each is only active (`when`) while
//    the cursor sits inside a table.
//
// All editing happens through `view.dispatch` on the active CodeMirror view,
// matching the documented pattern for editor extensions.
import type { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { NotablePlugin } from "notable-plugin-api";

const TABLE_LINE = /^[ \t]*\|(.*)\|[ \t]*$/;
const SEPARATOR_CELL = /^:?-{1,}:?$/;

type Alignment = "" | "left" | "center" | "right";

interface Cursor {
  modelRow: number;
  col: number;
  offsetInCell: number;
  onSeparator: boolean;
}

interface TableModel {
  header: string[];
  body: string[][];
  alignments: Alignment[];
}

interface ParsedTable extends TableModel {
  from: number;
  to: number;
  cursor: Cursor;
}

interface RenderedTable {
  lines: string[];
  widths: number[];
  colCount: number;
  header: string[];
  alignments: Alignment[];
  body: string[][];
}

type Transform = (model: TableModel, cursor: Cursor) => void;

interface CommandSpec {
  id: string;
  name: string;
  transform: Transform;
  enabled?: (table: ParsedTable) => boolean;
}

function splitCellsRaw(content: string): string[] {
  const cells: string[] = [];
  let current = "";
  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (ch === "\\" && content[i + 1] === "|") {
      current += "\\|";
      i++;
      continue;
    }
    if (ch === "|") {
      cells.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  cells.push(current);
  return cells;
}

function cellAlignment(cell: string): Alignment {
  const left = cell.startsWith(":");
  const right = cell.endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  if (left) return "left";
  return "";
}

function padArray<T>(arr: T[], len: number, fill: T): T[] {
  const out = arr.slice(0, len);
  while (out.length < len) out.push(fill);
  return out;
}

function padCell(text: string, width: number, align: Alignment): string {
  const pad = Math.max(0, width - text.length);
  if (align === "right") return " ".repeat(pad) + text;
  if (align === "center") {
    const left = Math.floor(pad / 2);
    return " ".repeat(left) + text + " ".repeat(pad - left);
  }
  return text + " ".repeat(pad);
}

function padStart(text: string, width: number, align: Alignment): number {
  const pad = Math.max(0, width - text.length);
  if (align === "right") return pad;
  if (align === "center") return Math.floor(pad / 2);
  return 0;
}

function cellInfoAt(
  lineText: string,
  col: number,
): { cellIndex: number; offsetInCell: number } {
  const pipeStart = lineText.indexOf("|");
  const pipeEnd = lineText.lastIndexOf("|");
  const content = lineText.slice(pipeStart + 1, pipeEnd);
  const rawCells = splitCellsRaw(content);

  let pos = pipeStart + 1;
  for (let i = 0; i < rawCells.length; i++) {
    const raw = rawCells[i];
    const start = pos;
    const end = pos + raw.length;
    const isLast = i === rawCells.length - 1;
    if (col <= end || isLast) {
      const leading = raw.match(/^\s*/)?.[0].length ?? 0;
      const trimmed = raw.trim();
      const offsetInRaw = Math.max(0, Math.min(col, end) - start);
      const offsetInCell = Math.max(
        0,
        Math.min(offsetInRaw - leading, trimmed.length),
      );
      return { cellIndex: i, offsetInCell };
    }
    pos = end + 1;
  }
  return { cellIndex: rawCells.length - 1, offsetInCell: 0 };
}

function colCountOf(model: TableModel): number {
  return Math.max(
    1,
    model.header.length,
    model.alignments.length,
    ...model.body.map((row) => row.length),
  );
}

function parseTable(state: EditorState, pos: number): ParsedTable | null {
  const doc = state.doc;
  const cur = doc.lineAt(pos);
  if (!TABLE_LINE.test(cur.text)) return null;

  let startLine = cur.number;
  while (startLine > 1 && TABLE_LINE.test(doc.line(startLine - 1).text)) {
    startLine--;
  }
  let endLine = cur.number;
  while (
    endLine < doc.lines &&
    TABLE_LINE.test(doc.line(endLine + 1).text)
  ) {
    endLine++;
  }
  if (endLine - startLine < 1) return null;

  const sepMatch = TABLE_LINE.exec(doc.line(startLine + 1).text);
  if (!sepMatch) return null;
  const sepCells = splitCellsRaw(sepMatch[1]).map((c) => c.trim());
  if (sepCells.length === 0 || !sepCells.every((c) => SEPARATOR_CELL.test(c))) {
    return null;
  }

  const headerMatch = TABLE_LINE.exec(doc.line(startLine).text);
  if (!headerMatch) return null;
  const header = splitCellsRaw(headerMatch[1]).map((c) => c.trim());
  const body: string[][] = [];
  for (let n = startLine + 2; n <= endLine; n++) {
    const rowMatch = TABLE_LINE.exec(doc.line(n).text);
    if (!rowMatch) continue;
    body.push(splitCellsRaw(rowMatch[1]).map((c) => c.trim()));
  }
  const alignments = sepCells.map(cellAlignment);

  const lineOffset = cur.number - startLine;
  const modelRow = lineOffset <= 1 ? 0 : lineOffset - 1;
  const { cellIndex, offsetInCell } = cellInfoAt(cur.text, pos - cur.from);

  return {
    from: doc.line(startLine).from,
    to: doc.line(endLine).to,
    header,
    body,
    alignments,
    cursor: {
      modelRow,
      col: cellIndex,
      offsetInCell,
      onSeparator: lineOffset === 1,
    },
  };
}

function renderRow(cells: string[], widths: number[], alignments: Alignment[]): string {
  return `| ${cells.map((c, i) => padCell(c, widths[i], alignments[i] || "left")).join(" | ")} |`;
}

function renderSeparator(widths: number[], alignments: Alignment[]): string {
  const cells = widths.map((w, i) => {
    const align = alignments[i] || "";
    if (align === "center") return `:${"-".repeat(Math.max(1, w - 2))}:`;
    if (align === "left") return `:${"-".repeat(Math.max(1, w - 1))}`;
    if (align === "right") return `${"-".repeat(Math.max(1, w - 1))}:`;
    return "-".repeat(w);
  });
  return `| ${cells.join(" | ")} |`;
}

function renderTable(model: TableModel): RenderedTable {
  const colCount = colCountOf(model);
  const header = padArray(model.header, colCount, "");
  const alignments = padArray(model.alignments, colCount, "" as Alignment);
  const body = model.body.map((row) => padArray(row, colCount, ""));

  const widths: number[] = [];
  for (let c = 0; c < colCount; c++) {
    let w = Math.max(3, header[c].length);
    for (const row of body) w = Math.max(w, row[c].length);
    widths.push(w);
  }

  const lines = [renderRow(header, widths, alignments), renderSeparator(widths, alignments)];
  for (const row of body) lines.push(renderRow(row, widths, alignments));

  return { lines, widths, colCount, header, alignments, body };
}

function padModel(model: TableModel): void {
  const colCount = colCountOf(model);
  model.header = padArray(model.header, colCount, "");
  model.alignments = padArray(model.alignments, colCount, "" as Alignment);
  model.body = model.body.map((row) => padArray(row, colCount, ""));
}

function applyTransform(view: EditorView, transform: Transform): boolean {
  const table = parseTable(view.state, view.state.selection.main.head);
  if (!table) return false;

  const model: TableModel = {
    header: table.header.slice(),
    body: table.body.map((row) => row.slice()),
    alignments: table.alignments.slice(),
  };
  padModel(model);
  const cursor: Cursor = { ...table.cursor };

  transform(model, cursor);

  const rendered = renderTable(model);
  const text = rendered.lines.join("\n");

  const lineIndex = cursor.modelRow === 0 ? 0 : cursor.modelRow + 1;
  const col = Math.min(Math.max(0, cursor.col), rendered.colCount - 1);
  const cellText =
    (cursor.modelRow === 0 ? rendered.header : rendered.body[cursor.modelRow - 1])[col] ?? "";
  const align = rendered.alignments[col] || "left";

  let charOffset = 2; // "| "
  for (let c = 0; c < col; c++) charOffset += rendered.widths[c] + 3; // " | "
  charOffset += padStart(cellText, rendered.widths[col], align);
  charOffset += Math.min(Math.max(0, cursor.offsetInCell), cellText.length);

  let pos = table.from;
  for (let i = 0; i < lineIndex; i++) pos += rendered.lines[i].length + 1;
  pos += charOffset;

  view.dispatch({
    changes: { from: table.from, to: table.to, insert: text },
    selection: { anchor: pos },
    scrollIntoView: true,
  });
  return true;
}

function tFormat(): void {}

function tNextCell(model: TableModel, cursor: Cursor): void {
  const colCount = colCountOf(model);
  cursor.col += 1;
  if (cursor.col >= colCount) {
    cursor.col = 0;
    cursor.modelRow += 1;
    if (cursor.modelRow - 1 >= model.body.length) {
      model.body.push(new Array(colCount).fill(""));
    }
  }
  cursor.offsetInCell = 0;
}

function tPrevCell(model: TableModel, cursor: Cursor): void {
  const colCount = colCountOf(model);
  cursor.col -= 1;
  if (cursor.col < 0) {
    if (cursor.modelRow > 0) {
      cursor.modelRow -= 1;
      cursor.col = colCount - 1;
    } else {
      cursor.col = 0;
    }
  }
  cursor.offsetInCell = Number.MAX_SAFE_INTEGER;
}

function tNextRow(model: TableModel, cursor: Cursor): void {
  const colCount = colCountOf(model);
  cursor.modelRow += 1;
  if (cursor.modelRow - 1 >= model.body.length) {
    model.body.push(new Array(colCount).fill(""));
  }
  cursor.offsetInCell = 0;
}

function tInsertRowAbove(model: TableModel, cursor: Cursor): void {
  const colCount = colCountOf(model);
  const bodyIdx = cursor.modelRow - 1;
  model.body.splice(bodyIdx, 0, new Array(colCount).fill(""));
  cursor.col = 0;
  cursor.offsetInCell = 0;
}

function tInsertRowBelow(model: TableModel, cursor: Cursor): void {
  const colCount = colCountOf(model);
  const bodyIdx = cursor.modelRow - 1;
  model.body.splice(bodyIdx + 1, 0, new Array(colCount).fill(""));
  cursor.modelRow += 1;
  cursor.col = 0;
  cursor.offsetInCell = 0;
}

function tDeleteRow(model: TableModel, cursor: Cursor): void {
  const bodyIdx = cursor.modelRow - 1;
  model.body.splice(bodyIdx, 1);
  if (model.body.length === 0) model.body.push(new Array(colCountOf(model)).fill(""));
  cursor.modelRow = Math.min(cursor.modelRow, model.body.length);
  cursor.offsetInCell = 0;
}

function tMoveRowUp(model: TableModel, cursor: Cursor): void {
  const bodyIdx = cursor.modelRow - 1;
  if (bodyIdx <= 0) return;
  [model.body[bodyIdx - 1], model.body[bodyIdx]] = [model.body[bodyIdx], model.body[bodyIdx - 1]];
  cursor.modelRow -= 1;
}

function tMoveRowDown(model: TableModel, cursor: Cursor): void {
  const bodyIdx = cursor.modelRow - 1;
  if (bodyIdx < 0 || bodyIdx >= model.body.length - 1) return;
  [model.body[bodyIdx], model.body[bodyIdx + 1]] = [model.body[bodyIdx + 1], model.body[bodyIdx]];
  cursor.modelRow += 1;
}

function tInsertColumnLeft(model: TableModel, cursor: Cursor): void {
  const idx = cursor.col;
  model.header.splice(idx, 0, "");
  model.alignments.splice(idx, 0, "");
  for (const row of model.body) row.splice(idx, 0, "");
  cursor.offsetInCell = 0;
}

function tInsertColumnRight(model: TableModel, cursor: Cursor): void {
  const idx = cursor.col + 1;
  model.header.splice(idx, 0, "");
  model.alignments.splice(idx, 0, "");
  for (const row of model.body) row.splice(idx, 0, "");
  cursor.col = idx;
  cursor.offsetInCell = 0;
}

function tDeleteColumn(model: TableModel, cursor: Cursor): void {
  if (colCountOf(model) <= 1) return;
  const idx = cursor.col;
  model.header.splice(idx, 1);
  model.alignments.splice(idx, 1);
  for (const row of model.body) row.splice(idx, 1);
  cursor.col = Math.min(idx, colCountOf(model) - 1);
  cursor.offsetInCell = 0;
}

function swapColumns(model: TableModel, a: number, b: number): void {
  [model.header[a], model.header[b]] = [model.header[b], model.header[a]];
  [model.alignments[a], model.alignments[b]] = [model.alignments[b], model.alignments[a]];
  for (const row of model.body) [row[a], row[b]] = [row[b], row[a]];
}

function tMoveColumnLeft(model: TableModel, cursor: Cursor): void {
  if (cursor.col <= 0) return;
  swapColumns(model, cursor.col, cursor.col - 1);
  cursor.col -= 1;
}

function tMoveColumnRight(model: TableModel, cursor: Cursor): void {
  const colCount = colCountOf(model);
  if (cursor.col >= colCount - 1) return;
  swapColumns(model, cursor.col, cursor.col + 1);
  cursor.col += 1;
}

function tSetAlign(align: Alignment): Transform {
  return (model, cursor) => {
    model.alignments[cursor.col] = align;
  };
}

function tSort(descending: boolean): Transform {
  return (model, cursor) => {
    const col = cursor.col;
    const allNumeric = model.body.every(
      (row) => row[col] === "" || !Number.isNaN(parseFloat(row[col])),
    );
    model.body.sort((a, b) => {
      const av = a[col] ?? "";
      const bv = b[col] ?? "";
      const cmp = allNumeric
        ? (parseFloat(av) || 0) - (parseFloat(bv) || 0)
        : av.localeCompare(bv, undefined, { numeric: true, sensitivity: "base" });
      return descending ? -cmp : cmp;
    });
    cursor.modelRow = model.body.length > 0 ? 1 : 0;
    cursor.offsetInCell = 0;
  };
}

const COMMANDS: CommandSpec[] = [
  { id: "format", name: "Format table", transform: tFormat },
  {
    id: "insert-row-above",
    name: "Insert table row above",
    transform: tInsertRowAbove,
    enabled: (t) => t.cursor.modelRow >= 1,
  },
  {
    id: "insert-row-below",
    name: "Insert table row below",
    transform: tInsertRowBelow,
  },
  {
    id: "delete-row",
    name: "Delete table row",
    transform: tDeleteRow,
    enabled: (t) => t.cursor.modelRow >= 1,
  },
  {
    id: "move-row-up",
    name: "Move table row up",
    transform: tMoveRowUp,
    enabled: (t) => t.cursor.modelRow >= 2,
  },
  {
    id: "move-row-down",
    name: "Move table row down",
    transform: tMoveRowDown,
    enabled: (t) => t.cursor.modelRow >= 1 && t.cursor.modelRow < t.body.length,
  },
  { id: "insert-column-left", name: "Insert table column left", transform: tInsertColumnLeft },
  { id: "insert-column-right", name: "Insert table column right", transform: tInsertColumnRight },
  {
    id: "delete-column",
    name: "Delete table column",
    transform: tDeleteColumn,
    enabled: (t) => colCountOf(t) > 1,
  },
  {
    id: "move-column-left",
    name: "Move table column left",
    transform: tMoveColumnLeft,
    enabled: (t) => t.cursor.col > 0,
  },
  {
    id: "move-column-right",
    name: "Move table column right",
    transform: tMoveColumnRight,
    enabled: (t) => t.cursor.col < colCountOf(t) - 1,
  },
  { id: "align-column-left", name: "Align table column left", transform: tSetAlign("left") },
  { id: "align-column-center", name: "Align table column center", transform: tSetAlign("center") },
  { id: "align-column-right", name: "Align table column right", transform: tSetAlign("right") },
  {
    id: "sort-ascending",
    name: "Sort table by column (ascending)",
    transform: tSort(false),
    enabled: (t) => t.body.length > 1,
  },
  {
    id: "sort-descending",
    name: "Sort table by column (descending)",
    transform: tSort(true),
    enabled: (t) => t.body.length > 1,
  },
];

const plugin: NotablePlugin = {
  onload(api) {
    const { state, view } = api.modules.codemirror;
    const { Prec } = state;
    const { keymap } = view;

    const activeTable = (): ParsedTable | null => {
      const editor = api.editor.activeView();
      if (!editor) return null;
      return parseTable(editor.state, editor.state.selection.main.head);
    };

    api.editor.registerExtension(
      Prec.highest(
        keymap.of([
          {
            key: "Tab",
            run: (editor) => applyTransform(editor, tNextCell),
          },
          {
            key: "Shift-Tab",
            run: (editor) => applyTransform(editor, tPrevCell),
          },
          {
            key: "Enter",
            run: (editor) => {
              const table = parseTable(editor.state, editor.state.selection.main.head);
              if (!table || table.cursor.onSeparator) return false;
              return applyTransform(editor, tNextRow);
            },
          },
        ]),
      ),
    );

    for (const spec of COMMANDS) {
      api.commands.register({
        id: `advanced-tables.${spec.id}`,
        name: spec.name,
        when: () => {
          const table = activeTable();
          if (!table) return false;
          return spec.enabled ? spec.enabled(table) : true;
        },
        run: () => {
          const editor = api.editor.activeView();
          if (editor) applyTransform(editor, spec.transform);
        },
      });
    }
  },
};

export default plugin;
