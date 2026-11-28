// Footnotes ("text[^label]" and "[^label]: definition") found in the Markdown source. The grammar
// has no footnote support, so this scan is the single model of them: the renderer numbers with it,
// and source-level features (sorting definitions, finding sources, ...) can build on its offsets.

export type FootnoteReference = {
  label: string;
  /** Source offsets of "[^label]". */
  start: number;
  end: number;
};

export type FootnoteDefinition = {
  label: string;
  /** Source offset of "[^label]:" (start) and of the end of that prefix. */
  start: number;
  labelEnd: number;
  /** End of the definition text: before the blank line that ends it, or before the next definition. */
  end: number;
};

export type Footnotes = {
  references: FootnoteReference[];
  definitions: FootnoteDefinition[];
  /** Number shown for a label: by first reference, only for referenced and defined labels (like GitHub). */
  numbers: Map<string, number>;
};

/** Labels match case-insensitively. */
export const footnoteKey = (label: string) => label.toLowerCase();

const definitionStart = /^[ \t]{0,3}\[\^([^\]\s]+)\]:/gm;
const reference = /\[\^([^\]\s]+)\]/g;

/** Code (fenced blocks and `spans`) blanked out with spaces, so offsets stay the same. */
function withoutCode(source: string): string {
  const blank = (text: string) => text.replace(/[^\n]/g, " ");
  return source
    .replace(/^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^ {0,3}\1[ \t]*$|(?![\s\S]))/gm, blank)
    .replace(/(`+)[^`\n][\s\S]*?\1/g, blank);
}

export function scanFootnotes(source: string): Footnotes {
  const text = withoutCode(source);
  const definitions: FootnoteDefinition[] = [];
  for (const match of text.matchAll(definitionStart)) {
    const start = match.index + match[0].indexOf("[");
    definitions.push({ label: match[1] ?? "", start, labelEnd: match.index + match[0].length, end: text.length });
  }
  for (const [index, definition] of definitions.entries()) {
    // Ends at a blank line not followed by an indented continuation line, or at the next definition.
    const after = text.slice(definition.labelEnd);
    const blank = after.search(/\n[ \t]*\n(?![ \t]{4}|\t)/);
    const next = definitions[index + 1]?.start ?? text.length;
    definition.end = Math.min(blank === -1 ? text.length : definition.labelEnd + blank, next);
  }
  const definitionStarts = new Set(definitions.map((definition) => definition.start));
  const references: FootnoteReference[] = [];
  for (const match of text.matchAll(reference)) {
    if (definitionStarts.has(match.index)) {continue;}
    references.push({ label: match[1] ?? "", start: match.index, end: match.index + match[0].length });
  }
  const defined = new Set(definitions.map((definition) => footnoteKey(definition.label)));
  const numbers = new Map<string, number>();
  for (const { label } of references) {
    const key = footnoteKey(label);
    if (defined.has(key) && !numbers.has(key)) {numbers.set(key, numbers.size + 1);}
  }
  return { references, definitions, numbers };
}
