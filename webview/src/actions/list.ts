// Sorting the Markdown list under the caret (A→Z, Z→A, by number).
import { icons } from "../icons";
import type { EditorAction, EditorContext } from "./types";

export type ListSortMode = "alphabetical" | "reverse" | "numerical";

const itemPattern = /^([ \t]*)([-+*]|\d{1,9}[.)])([ \t]+|$)(.*)$/;

type ListItem = { lines: string[]; text: string; marker: string; indent: string };
type ListBlock = { start: number; end: number; items: ListItem[]; caretItem: number; caretOffset: number };

function indentWidth(line: string): number {
  return (line.match(/^[ \t]*/)?.[0] ?? "").replaceAll("\t", "    ").length;
}

/**
 * Finds the list level the caret is in: consecutive items with the same indentation,
 * each carrying its nested / continuation lines. Blank lines end the list.
 */
export function findList(source: string, offset: number): ListBlock | null {
  const lines = source.split("\n");
  const starts: number[] = [];
  let position = 0;
  for (const line of lines) {
    starts.push(position);
    position += line.length + 1;
  }
  let caretLine = 0;
  while (caretLine + 1 < lines.length && (starts[caretLine + 1] ?? Infinity) <= offset) caretLine++;

  // The item that owns the caret line: walk up to the nearest item line not indented deeper.
  let owner = -1;
  const caretIndent = indentWidth(lines[caretLine] ?? "");
  for (let index = caretLine; index >= 0; index--) {
    const line = lines[index] ?? "";
    if (!line.trim()) return null;
    if (itemPattern.test(line) && indentWidth(line) <= caretIndent) {
      owner = index;
      break;
    }
  }
  if (owner === -1) return null;
  const baseIndent = indentWidth(lines[owner] ?? "");

  const belongs = (line: string) =>
    line.trim() !== "" && (indentWidth(line) > baseIndent || (itemPattern.test(line) && indentWidth(line) === baseIndent));

  let first = owner;
  while (first > 0 && belongs(lines[first - 1] ?? "")) first--;
  // Skip leading lines that are deeper than the list level (belong to an outer item's text).
  while (first < owner && !(itemPattern.test(lines[first] ?? "") && indentWidth(lines[first] ?? "") === baseIndent)) {
    first++;
  }
  let last = owner;
  while (last + 1 < lines.length && belongs(lines[last + 1] ?? "")) last++;

  const items: ListItem[] = [];
  let caretItem = 0;
  for (let index = first; index <= last; index++) {
    const line = lines[index] ?? "";
    const match = line.match(itemPattern);
    if (match && indentWidth(line) === baseIndent) {
      items.push({ lines: [line], text: match[4] ?? "", marker: match[2] ?? "-", indent: match[1] ?? "" });
    } else {
      items.at(-1)?.lines.push(line);
    }
    if (index === caretLine) caretItem = items.length - 1;
  }
  if (items.length < 2) return null;

  const start = starts[first] ?? 0;
  const end = (starts[last] ?? 0) + (lines[last] ?? "").length;
  let itemStart = start;
  for (let index = 0; index < caretItem; index++) {
    itemStart += (items[index]?.lines.join("\n").length ?? 0) + 1;
  }
  return { start, end, items, caretItem, caretOffset: offset - itemStart };
}

function leadingNumber(text: string): number | undefined {
  const match = text.replace(/[*_`~[\]]/g, "").match(/-?\d+(?:[.,]\d+)?/);
  return match ? Number(match[0].replace(",", ".")) : undefined;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function compare(mode: ListSortMode, a: ListItem, b: ListItem): number {
  if (mode === "numerical") {
    const left = leadingNumber(a.text);
    const right = leadingNumber(b.text);
    if (left !== undefined && right !== undefined && left !== right) return left - right;
    if (left === undefined && right !== undefined) return 1;
    if (left !== undefined && right === undefined) return -1;
  }
  const order = collator.compare(a.text.trim(), b.text.trim());
  return mode === "reverse" ? -order : order;
}

/** Sorts the list under the caret. Returns the replacement, or null when not inside a list. */
export function sortListAt(source: string, offset: number, mode: ListSortMode) {
  const list = findList(source, offset);
  if (!list) return null;
  const caretItem = list.items[list.caretItem];
  // Stable sort: equal items keep their order.
  const sorted = list.items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => compare(mode, a.item, b.item) || a.index - b.index)
    .map(({ item }) => item);

  // Ordered lists are renumbered from the first number, keeping "." or ")".
  const firstNumber = Number.parseInt(list.items[0]?.marker ?? "", 10);
  const renumbered = sorted.map((item, index) => {
    if (!/^\d/.test(item.marker) || Number.isNaN(firstNumber)) return item.lines;
    const marker = `${firstNumber + index}${item.marker.slice(-1)}`;
    const [head = "", ...rest] = item.lines;
    return [`${item.indent}${marker}${head.slice(item.indent.length + item.marker.length)}`, ...rest];
  });

  const text = renumbered.map((lines) => lines.join("\n")).join("\n");
  let caret = list.start;
  for (const [index, item] of sorted.entries()) {
    if (item === caretItem) {
      const length = renumbered[index]?.join("\n").length ?? 0;
      caret += Math.min(Math.max(list.caretOffset, 0), length);
      break;
    }
    caret += (renumbered[index]?.join("\n").length ?? 0) + 1;
  }
  return { start: list.start, end: list.end, text, caret };
}

function caretOffset(editor: EditorContext): number | undefined {
  return editor.selection()?.focus;
}

function sortAction(mode: ListSortMode, id: string, label: string, hint: string, icon: string): EditorAction {
  return {
    id,
    group: "List",
    label,
    hint,
    icon,
    disabledReason: "Place the cursor in a list",
    isEnabled(editor) {
      const offset = caretOffset(editor);
      return offset !== undefined && findList(editor.source(), offset) !== null;
    },
    run(editor) {
      const offset = caretOffset(editor);
      if (offset === undefined) return;
      const result = sortListAt(editor.source(), offset, mode);
      if (result) editor.replace(result.start, result.end, result.text, result.caret);
    },
  };
}

export const listActions: EditorAction[] = [
  sortAction("alphabetical", "sort-list-az", "Sort list A → Z", "apple, banana, cherry", icons["sort-az"]),
  sortAction("reverse", "sort-list-za", "Sort list Z → A", "cherry, banana, apple", icons["sort-za"]),
  sortAction("numerical", "sort-list-numbers", "Sort list by number", "2 eggs, 10 apples", icons["sort-numbers"]),
];
