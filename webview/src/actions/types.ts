// Contract between editor actions (table, list, ...) and the editor / tool menu.

export type EditorSelection = { anchor: number; focus: number };

/** The part of the editor an action may use: read the Markdown source and replace parts of it. */
export type EditorContext = {
  source(): string;
  /** Current selection, or the last one inside the editor (menus take focus away). */
  selection(): EditorSelection | null;
  /** Replaces source[start, end) and puts the caret at `caret` (default: after the text). */
  replace(start: number, end: number, text: string, caret?: number): void;
};

export type EditorAction = {
  id: string;
  /** Menu section the action is listed under, e.g. "Insert" or "List". */
  group: string;
  label: string;
  /** Tiny example of the result, shown next to the label in the menu tooltip. */
  hint: string;
  /** Inline SVG markup (24x24 viewBox, stroke = currentColor). */
  icon: string;
  /** Why the action is unavailable right now; shown instead of the hint. */
  disabledReason?: string;
  isEnabled?(editor: EditorContext): boolean;
  run(editor: EditorContext): void;
};
