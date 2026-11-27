// Markdown table helpers: insert a new table and add/remove rows and columns.
import type { EditorAction } from "./types";

export type TableResizeAction = "column" | "row" | "remove-column" | "remove-row";

/** Splits a table row into trimmed cells, respecting escaped pipes (`\|`). */
export function tableCells(line: string): string[] {
  const trimmed = line.trim();
  const content = trimmed.startsWith("|") ? trimmed.slice(1) : trimmed;
  const row = content.endsWith("|") ? content.slice(0, -1) : content;
  const cells: string[] = [];
  let start = 0;
  for (let index = 0; index < row.length; index++) {
    if (row[index] !== "|") continue;
    let backslashes = 0;
    for (let previous = index - 1; previous >= 0 && row[previous] === "\\"; previous--) {
      backslashes++;
    }
    if (backslashes % 2 !== 0) continue;
    cells.push(row.slice(start, index).trim());
    start = index + 1;
  }
  cells.push(row.slice(start).trim());
  return cells;
}

/** Returns the table source with a row/column added or removed. */
export function resizeTable(source: string, action: TableResizeAction): string {
  const trailingNewline = source.endsWith("\n");
  const lines = source.split("\n");
  if (trailingNewline) lines.pop();
  if (!lines.length) return source;
  if (action === "column" || action === "remove-column") {
    if (action === "remove-column" && tableCells(lines[0] ?? "").length <= 1) return source;
    for (const [index, line] of lines.entries()) {
      const cells = tableCells(line);
      if (action === "column") cells.push(index === 1 ? "---" : "");
      else cells.pop();
      lines[index] = `| ${cells.join(" | ")} |`;
    }
  } else if (action === "remove-row") {
    if (lines.length > 2) lines.pop();
  } else {
    const columns = tableCells(lines[0] ?? "").length;
    // Zero-width spaces keep the new empty row a valid, clickable table row.
    lines.push(`| ${Array.from({ length: columns }, () => "​").join(" | ")} |`);
  }
  return `${lines.join("\n")}${trailingNewline ? "\n" : ""}`;
}

const emptyTable = "|  |  |\n| --- | --- |\n|  |  |";

export const insertTableAction: EditorAction = {
  id: "insert-table",
  group: "Insert",
  label: "Table",
  hint: "| A | B |",
  icon: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17M3.5 14.5h17M12 4.5v15"/></svg>`,
  run(editor) {
    const source = editor.source();
    const selection = editor.selection();
    const start = selection ? Math.min(selection.anchor, selection.focus) : source.length;
    const end = selection ? Math.max(selection.anchor, selection.focus) : start;
    const before = source.slice(0, start);
    const after = source.slice(end);
    // Tables need blank lines around them to be parsed as tables.
    const prefix = before ? (before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n") : "";
    const suffix = after ? (after.startsWith("\n\n") ? "" : after.startsWith("\n") ? "\n" : "\n\n") : "\n";
    editor.replace(start, end, `${prefix}${emptyTable}${suffix}`, start + prefix.length + emptyTable.length);
  },
};
