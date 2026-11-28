import { Edit, Language, Parser, type Node, type Range, type Tree } from "web-tree-sitter";
import runtimeUrl from "web-tree-sitter/web-tree-sitter.wasm?url";
import { footnoteKey, scanFootnotes } from "./footnotes";
import type { VNode } from "./vdom";

const voidTags = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

const lineEndingNodes = new Set(["atx_heading", "list_item", "paragraph"]);

/** Containers whose children are top-level blocks; `<details>` is only grouped there. */
const blockContainers = new Set(["document", "section", "details_body"]);
const detailsOpenTag = /^[ \t]{0,3}<details\b(?:[^>"']|"[^"]*"|'[^']*')*>/i;

/** GFM bare URL ("https://example.com/path"); trailing punctuation is not part of it. */
const bareUrl = /\bhttps?:\/\/[^\s<>]*[^\s<>.,:;"')\]!?*_~]/g;

/** Reference link labels match case-insensitively, with whitespace collapsed. */
const labelKey = (label: string) => label.trim().replace(/\s+/g, " ").toLowerCase();

/** Bare URLs in the text of an inline become links (tree-sitter has no GFM autolink extension). */
function linkBareUrls(nodes: VNode[]): VNode[] {
  const merged: VNode[] = [];
  for (const node of nodes) {
    const last = merged.at(-1);
    if (typeof node === "string" && typeof last === "string") merged[merged.length - 1] = last + node;
    else merged.push(node);
  }
  return merged.flatMap((node): VNode[] => {
    if (typeof node !== "string") return [node];
    const parts: VNode[] = [];
    let offset = 0;
    for (const match of node.matchAll(bareUrl)) {
      if (match.index > offset) parts.push(node.slice(offset, match.index));
      parts.push({ type: "inline_link", href: match[0], children: [match[0]] });
      offset = match.index + match[0].length;
    }
    if (offset < node.length) parts.push(node.slice(offset));
    return parts;
  });
}

/** The ":" after "[^label]" of a footnote definition becomes part of it (a marker). */
function attachDefinitionColons(nodes: VNode[]): VNode[] {
  for (const [index, node] of nodes.entries()) {
    const next = nodes[index + 1];
    if (typeof node === "string" || node.type !== "footnote_definition" || typeof next !== "string") continue;
    if (!next.startsWith(":")) continue;
    node.children.push({ type: "marker", children: [":"] });
    nodes[index + 1] = next.slice(1);
  }
  return nodes.filter((node) => node !== "");
}

function htmlEnd(source: string, start: number) {
  const opening = source
    .slice(start)
    .match(/^<([a-z][\w:-]*)(?=[\s/>])(?:[^>"']|"[^"]*"|'[^']*')*>/i);
  const tag = opening?.[1]?.toLowerCase();
  if (!opening || !tag) return null;
  if (voidTags.has(tag) || opening[0].endsWith("/>")) return start + opening[0].length;
  const tags = new RegExp(
    `<!--[\\s\\S]*?-->|<(/?)${tag}(?=[\\s/>])(?:[^>"']|"[^"]*"|'[^']*')*>`,
    "gi",
  );
  tags.lastIndex = start + opening[0].length;
  let depth = 1;
  for (let match = tags.exec(source); match; match = tags.exec(source)) {
    if (match[0].startsWith("<!--")) continue;
    if (match[1]) depth--;
    else if (!match[0].endsWith("/>")) depth++;
    if (depth === 0) return tags.lastIndex;
  }
  return null;
}

function point(source: string, index: number) {
  const before = source.slice(0, index);
  return { row: before.split("\n").length - 1, column: index - before.lastIndexOf("\n") - 1 };
}

function changedRange(before: string, after: string): Edit {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let oldEnd = before.length;
  let newEnd = after.length;
  while (oldEnd > start && newEnd > start && before[oldEnd - 1] === after[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }
  return new Edit({
    startIndex: start,
    oldEndIndex: oldEnd,
    newEndIndex: newEnd,
    startPosition: point(before, start),
    oldEndPosition: point(before, oldEnd),
    newEndPosition: point(after, newEnd),
  });
}

// The WebAssembly runtime may only be initialised once; every renderer shares it.
let languages: Promise<[Language, Language]> | undefined;

function loadLanguages(): Promise<[Language, Language]> {
  languages ??= Parser.init({ locateFile: () => runtimeUrl }).then(() =>
    Promise.all([
      Language.load(`${import.meta.env.BASE_URL}wasm/tree-sitter-markdown.wasm`),
      Language.load(`${import.meta.env.BASE_URL}wasm/tree-sitter-markdown_inline.wasm`),
    ]),
  );
  return languages;
}

/**
 * Tree-sitter puts the indentation / `>` prefix of a nested block's first line before that block
 * (often at the end of the previous one). Hidden there it still forms an empty line of its own, so
 * it is moved to the start of the block it belongs to. Text order (and every offset) is unchanged.
 */
function hoistContinuations(nodes: VNode[]): void {
  const isPrefix = (node: VNode | undefined) =>
    typeof node === "object" && (node.type === "marker" || node.type === "indent");
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index];
    if (typeof node === "string") continue;
    hoistContinuations(node.children);
    let next = nodes[index + 1];
    if (!next || typeof next === "string" || isPrefix(next)) continue;
    // The line's prefix: this node itself or the last node deep inside it.
    let siblings = nodes;
    let at = index;
    for (let last: VNode | undefined = node; typeof last === "object" && !isPrefix(last); last = siblings[at]) {
      siblings = last.children;
      at = siblings.length - 1;
    }
    const marker = siblings[at];
    const before = siblings[at - 1];
    if (!isPrefix(marker) || typeof marker !== "object" || typeof before !== "string" || !before.endsWith("\n")) continue;
    siblings.splice(at, 1);
    if (siblings === nodes) index--;
    while (next.type === "list" && typeof next.children[0] === "object") next = next.children[0];
    next.children.unshift(marker);
  }
}

/** Creates an independent renderer (own parse state); used by the editor and link previews. */
export async function createMarkdown() {
  const [blockLanguage, inlineLanguage] = await loadLanguages();
  const blockParser = new Parser();
  const inlineParser = new Parser();
  blockParser.setLanguage(blockLanguage);
  inlineParser.setLanguage(inlineLanguage);
  let source = "";
  let blockTree: Tree | null = null;
  let inlineTrees: Tree[] = [];

  function lineEndingLength(endIndex: number) {
    if (source[endIndex - 1] !== "\n") return 0;
    return source[endIndex - 2] === "\r" ? 2 : 1;
  }

  return (nextSource: string, activeOffset?: number): VNode[] => {
    if (blockTree && source !== nextSource) {
      const edit = changedRange(source, nextSource);
      blockTree.edit(edit);
      for (const tree of inlineTrees) tree.edit(edit);
    }
    source = nextSource;
    const nextBlockTree = blockParser.parse(source, blockTree);
    if (!nextBlockTree) throw new Error("Tree-sitter could not parse the Markdown blocks.");
    blockTree?.delete();
    blockTree = nextBlockTree;
    const nextInlineTrees: Tree[] = [];
    let coveredUntil = 0;

    const footnotes = scanFootnotes(source);
    const footnoteDefinitions = new Set(footnotes.definitions.map((definition) => definition.start));

    // "[label]: url" definitions, for reference links anywhere in the document (first one wins).
    const definitions = new Map<string, string>();
    for (const definition of blockTree.rootNode.descendantsOfType("link_reference_definition")) {
      const label = definition?.namedChildren.find((child) => child.type === "link_label");
      const destination = definition?.namedChildren.find((child) => child.type === "link_destination");
      const key = label && labelKey(label.text.slice(1, -1));
      if (key && destination && !definitions.has(key)) {
        definitions.set(key, destination.text.replace(/^<|>$/g, ""));
      }
    }

    function children(
      node: Pick<Node, "startIndex" | "endIndex"> & { type?: string },
      nodes: Node[],
      htmlLimit = source.length,
    ): VNode[] {
      const result: VNode[] = [];
      let offset = Math.max(node.startIndex, coveredUntil);
      for (const [index, child] of nodes.entries()) {
        if (child.endIndex <= offset || child.startIndex > node.endIndex) continue;
        if (child.startIndex > offset) {
          const gap = source.slice(offset, child.startIndex);
          const previous = nodes[index - 1];
          result.push(
            node.type === "list" &&
              previous?.type === "list_item" &&
              child.type === "list_item" &&
              /\n[ \t]*\n/.test(gap)
              ? { type: "list_gap", children: [gap] }
              : gap,
          );
        }
        const lastListItemChild = child.type === "list_item" ? child.namedChildren.at(-1) : undefined;
        const lineEnding =
          lineEndingNodes.has(child.type) &&
            !(
              child.type === "list_item" &&
              ["paragraph", "list"].includes(lastListItemChild?.type ?? "") &&
              lastListItemChild?.endIndex === child.endIndex
            )
            ? lineEndingLength(child.endIndex)
            : 0;
        if (child.type === "html_block" && blockContainers.has(node.type ?? "") && detailsOpenTag.test(source.slice(child.startIndex, child.endIndex))) {
          const details = renderDetails(child.startIndex);
          if (details) {
            result.push(details.node);
            coveredUntil = details.end;
            offset = details.end;
            continue;
          }
        }
        const end =
          child.type === "html_tag" ||
            ((node.type === undefined || node.type === "ERROR") && child.type === "<")
            ? htmlEnd(source, child.startIndex)
            : null;
        if (end !== null && end <= htmlLimit) {
          const html = source.slice(child.startIndex, end);
          result.push({
            type: end > node.endIndex ? "html_block" : "html_inline",
            children: [html],
            preview: { kind: "html", source: html },
          });
          coveredUntil = end;
          offset = end;
          continue;
        }
        const rendered = render(child, node.type);
        result.push(rendered);
        if (lineEnding && !(typeof rendered === "string" && rendered.endsWith("\n"))) {
          result.push(source.slice(child.endIndex - lineEnding, child.endIndex));
        }
        offset = Math.max(child.endIndex, coveredUntil);
      }
      if (offset < node.endIndex) result.push(source.slice(offset, node.endIndex));
      return result;
    }

    function inline(
      startIndex: number,
      endIndex: number,
      excluded: Node[] = [],
      htmlLimit = source.length,
    ): VNode[] {
      if (startIndex === endIndex) return [];
      const ranges: Range[] = [];
      let start = startIndex;
      for (const child of excluded) {
        if (child.startIndex > start) {
          ranges.push({
            startIndex: start,
            startPosition: point(source, start),
            endIndex: child.startIndex,
            endPosition: child.startPosition,
          });
        }
        start = child.endIndex;
      }
      if (start < endIndex)
        ranges.push({
          startIndex: start,
          startPosition: point(source, start),
          endIndex,
          endPosition: point(source, endIndex),
        });
      if (!ranges.length) return [source.slice(startIndex, endIndex)];
      const tree = inlineParser.parse(source, inlineTrees[nextInlineTrees.length], {
        includedRanges: ranges,
      });
      if (!tree) throw new Error(`Tree-sitter could not parse inline Markdown at ${startIndex}.`);
      nextInlineTrees.push(tree);
      // Excluded nodes (`>` / indentation of continuation lines) are rendered as markers in place.
      const nodes = [...tree.rootNode.children, ...excluded].sort((a, b) => a.startIndex - b.startIndex);
      return children({ startIndex, endIndex }, nodes, htmlLimit);
    }

    function tableRows(start: number, end: number): VNode[] {
      return [...source.slice(start, end).matchAll(/[^\n]+/g)].flatMap((line, index): VNode[] => {
        if (index === 1) return [];
        const rowStart = start + line.index;
        const text = line[0];
        const pipes = [...text.matchAll(/(?<!\\)(?:\\\\)*\|/g)].map(
          (pipe) => rowStart + pipe.index + pipe[0].length - 1,
        );
        const bounds = [rowStart - 1, ...pipes, rowStart + text.length];
        if (text.trimStart().startsWith("|")) bounds.shift();
        if (pipes.at(-1) === rowStart + text.trimEnd().length - 1) bounds.pop();
        const cells: VNode[] = [];
        for (let index = 0; index + 1 < bounds.length; index++) {
          const before = bounds[index];
          const after = bounds[index + 1];
          if (before === undefined || after === undefined) continue;
          const cellStart = before + 1;
          const cellEnd = after;
          const cellText = source.slice(cellStart, cellEnd);

          cells.push({
            type: "pipe_table_cell",
            sourceRange: { start: cellStart, end: cellEnd },
            children: cellText.replace(/\u200B/g, "").trim() === ""
              ? []
              : linkBareUrls(inline(cellStart, cellEnd, [], cellEnd)),
          });
        }
        return [{ type: index === 0 ? "pipe_table_header" : "pipe_table_row", children: cells }];
      });
    }

    /** Block nodes overlapping [start, end); sections are flattened (headings start new sections). */
    function blocksIn(parent: Node, start: number, end: number, out: Node[] = []): Node[] {
      for (const child of parent.children) {
        if (child.endIndex <= start || child.startIndex >= end) continue;
        if (child.type === "section") blocksIn(child, start, end, out);
        else out.push(child);
      }
      return out;
    }

    /**
     * `<details><summary>Title</summary> … </details>` as a collapsible block whose body is
     * rendered as Markdown (like GitHub does when blank lines separate the tags from the content).
     * The tags stay in the text (hidden by CSS) so the source round-trips unchanged.
     * Returns null to fall back to the plain HTML preview.
     */
    function renderDetails(start: number): { node: VNode; end: number } | null {
      if (!blockTree) return null;
      const end = htmlEnd(source, start);
      if (end === null) return null;
      const whole = source.slice(start, end);
      const openTag = whole.match(detailsOpenTag);
      const closeTag = whole.match(/<\/details\s*>$/i);
      if (!openTag || !closeTag) return null;
      const openEnd = start + openTag[0].length;
      const closeStart = end - closeTag[0].length;

      const summary = source
        .slice(openEnd, closeStart)
        .match(/^(\s*)(<summary\b(?:[^>"']|"[^"]*"|'[^']*')*>)([\s\S]*?)(<\/summary\s*>)/i);
      const summaryStart = openEnd + (summary?.[1]?.length ?? 0);
      const labelStart = summaryStart + (summary?.[2]?.length ?? 0);
      const labelEnd = labelStart + (summary?.[3]?.length ?? 0);
      const summaryEnd = labelEnd + (summary?.[4]?.length ?? 0);
      const bodyStart = summaryEnd + (source.slice(summaryEnd, closeStart).match(/^\s*/)?.[0].length ?? 0);

      const savedCovered = coveredUntil;
      const savedTrees = nextInlineTrees.length;
      const fail = () => {
        coveredUntil = savedCovered;
        for (const tree of nextInlineTrees.splice(savedTrees)) tree.delete();
        return null;
      };

      const label = labelEnd > labelStart ? inline(labelStart, labelEnd, [], labelEnd) : [];
      coveredUntil = Math.max(coveredUntil, bodyStart);

      const body: VNode[] = [];
      let position = bodyStart;
      for (const block of blocksIn(blockTree.rootNode, bodyStart, closeStart)) {
        if (block.endIndex <= position) continue;
        if (block.startIndex >= position && block.endIndex <= closeStart) {
          body.push(...children({ startIndex: position, endIndex: block.endIndex, type: "details_body" }, [block]));
          position = Math.max(block.endIndex, coveredUntil);
        } else if (block.type === "html_block") {
          // Raw HTML sharing lines with the tags (no blank line): render that part as HTML.
          const clipStart = Math.max(block.startIndex, position);
          const clipEnd = Math.min(block.endIndex, closeStart);
          if (clipStart > position) body.push(source.slice(position, clipStart));
          const html = source.slice(clipStart, clipEnd);
          body.push(html.trim() ? { type: "html_block", children: [html], preview: { kind: "html", source: html } } : html);
          position = clipEnd;
          coveredUntil = Math.max(coveredUntil, clipEnd);
        } else {
          return fail();
        }
        if (position > closeStart) return fail();
      }
      // Trailing blank lines before </details> belong to the hidden closing tag.
      const bodyEnd = Math.max(position, closeStart - (source.slice(position, closeStart).match(/\s*$/)?.[0].length ?? 0));
      if (bodyEnd > position) body.push(source.slice(position, bodyEnd));

      const part = (type: string, from: number, to: number): VNode[] =>
        to > from ? [{ type, children: [source.slice(from, to)] }] : [];
      return {
        end,
        node: {
          type: "details",
          open: /\sopen\b/i.test(openTag[0]),
          children: [
            {
              type: "details_summary",
              children: [
                ...part("details_marker", start, summaryStart),
                ...part("details_tag", summaryStart, labelStart),
                { type: "details_label", children: label },
                ...part("details_tag", labelEnd, summaryEnd),
                ...part("details_marker", summaryEnd, bodyStart),
              ],
            },
            { type: "details_body", children: body },
            ...part("details_marker", bodyEnd, end),
          ],
        },
      };
    }

    function render(node: Node, parentType = ""): VNode {
      if (node.startIndex < coveredUntil) {
        return node.childCount
          ? { type: node.type, children: children(node, node.children) }
          : source.slice(coveredUntil, node.endIndex);
      }
      if (node.type === "ERROR") {
        const pending = source.slice(node.startIndex, node.endIndex);
        if (/^#{1,6}[ \t]+$/.test(pending)) {
          return { type: "atx_heading", children: children(node, node.children) };
        }
        const listMarker = node.children.find(
          (child) =>
            child.type === "list_marker_minus" ||
            child.type === "list_marker_plus" ||
            child.type === "list_marker_star" ||
            child.type === "list_marker_dot" ||
            child.type === "list_marker_parenthesis",
        );
        if (listMarker && /^(?:[-+*]|\d+[.)])[ \t]+$/.test(pending)) {
          if (
            activeOffset !== undefined &&
            activeOffset >= node.startIndex &&
            activeOffset <= node.endIndex
          ) {
            return pending;
          }
          return {
            type: "list",
            children: [{ type: "list_item", children: children(node, node.children) }],
            start:
              listMarker.type === "list_marker_dot" || listMarker.type === "list_marker_parenthesis"
                ? Number.parseInt(listMarker.text, 10)
                : undefined,
          };
        }
      }
      if (node.type === "html_block") {
        const end = Math.max(node.endIndex, htmlEnd(source, node.startIndex) ?? node.endIndex);
        const html = source.slice(node.startIndex, end);
        coveredUntil = end;
        return {
          type: node.type,
          children: [html],
          preview: { kind: "html", source: html },
        };
      }
      if (node.type === "thematic_break") {
        const endIndex = node.endIndex - lineEndingLength(node.endIndex);
        const lineEnding = source.slice(endIndex, node.endIndex);
        return {
          type: "thematic_break",
          children: [
            source.slice(node.startIndex, endIndex),
            ...(lineEnding
              ? [{ type: "thematic_break_line_ending", children: [lineEnding] }]
              : []),
          ],
        };
      }
      if (node.type === "image") {
        const destination = node.namedChildren.find((child) => child.type === "link_destination");
        if (destination) {
          return {
            type: node.type,
            children: [node.text],
            preview: {
              kind: "image",
              src: destination.text.replace(/^<|>$/g, ""),
              alt:
                node.namedChildren.find((child) => child.type === "image_description")?.text ?? "",
            },
          };
        }
      }
      if (node.type === "pipe_table") {
        let end = node.endIndex;
        while (/^[ \t]*\|/.test(source.slice(end))) {
          const newline = source.indexOf("\n", end);
          end = newline === -1 ? source.length : newline + 1;
        }
        const rows = tableRows(node.startIndex, end);
        const delimiter = node.namedChildren.find(
          (child) => child.type === "pipe_table_delimiter_row",
        );
        const align =
          delimiter?.namedChildren
            .filter((cell) => cell.type === "pipe_table_delimiter_cell")
            .map((cell): "left" | "center" | "right" =>
              cell.text.endsWith(":") ? (cell.text.startsWith(":") ? "center" : "right") : "left",
            ) ?? [];
        coveredUntil = end;
        return {
          type: node.type,
          children: [source.slice(node.startIndex, end)],
          preview: {
            kind: "table",
            rows,
            align,
            start: node.startIndex,
            end,
          },
        };
      }
      if (node.type === "setext_heading") {
        const content = node.namedChildren.find((child) => child.type === "paragraph");
        const underline = node.namedChildren.find((child) => child.type.startsWith("setext_h"));
        if (content && underline) {
          // The underline (with the line break before it) is hidden unless the heading is active.
          const textEnd = content.endIndex - lineEndingLength(content.endIndex);
          return {
            type: node.type,
            start: underline.type === "setext_h1_underline" ? 1 : 2,
            children: [
              ...children({ startIndex: content.startIndex, endIndex: textEnd, type: content.type }, content.children),
              { type: "setext_underline", children: [source.slice(textEnd, underline.endIndex)] },
              source.slice(underline.endIndex, node.endIndex),
            ],
          };
        }
      }
      if (
        node.type === "paragraph" &&
        node.endIndex === source.length &&
        /^[ \t]{0,3}(?:-[ \t]*){3,}$/.test(source.slice(node.startIndex, node.endIndex))
      ) {
        return {
          type: "thematic_break",
          children: [source.slice(node.startIndex, node.endIndex)],
        };
      }
      if (
        (node.type === "atx_heading" || node.type === "list_item" || node.type === "paragraph") &&
        node.childCount
      ) {
        const endIndex = node.endIndex - lineEndingLength(node.endIndex);

        const marker = node.namedChildren.find((child) => child.type.startsWith("atx_h"));

        return {
          type: node.type,
          ...(node.type === "atx_heading" && marker
            ? { start: Number(marker.type.match(/\d+/)?.[0]) }
            : {}),
          children: children(
            { startIndex: node.startIndex, endIndex, type: node.type },
            node.children,
          ),
        };
      }
      if (node.type === "inline" || node.type === "pipe_table_cell") {
        return {
          type: node.type,
          children: attachDefinitionColons(
            linkBareUrls(inline(node.startIndex, node.endIndex, node.namedChildren, source.length)),
          ),
        };
      }
      const marker =
        node.type.endsWith("_delimiter") ||
        node.type.endsWith("_marker") ||
        node.type.startsWith("list_marker_") ||
        node.type === "block_continuation" ||
        node.type === "info_string" ||
        (parentType === "inline_link" && node.type !== "link_text");
      const activeLineStart =
        activeOffset === undefined ? -1 : source.lastIndexOf("\n", activeOffset - 1) + 1;
      const activeLineEnd = source.indexOf("\n", activeLineStart);
      if (
        node.type.startsWith("atx_h") &&
        node.type.endsWith("_marker") &&
        activeOffset !== undefined &&
        node.startIndex >= activeLineStart &&
        (activeLineEnd === -1 || node.startIndex < activeLineEnd)
      ) {
        return source.slice(node.startIndex, node.endIndex);
      }
      if (marker)
        return {
          // Pure indentation stays hidden even on the active line: CSS already indents the block.
          type: node.type.startsWith("list_marker_")
            ? node.type
            : node.type === "block_continuation" && !source.slice(node.startIndex, node.endIndex).trim()
              ? "indent"
              : "marker",
          children: [source.slice(node.startIndex, node.endIndex)],
        };
      if (node.type === "list") {
        const listMarker = node.firstNamedChild?.firstNamedChild;
        if (
          listMarker?.type === "list_marker_dot" ||
          listMarker?.type === "list_marker_parenthesis"
        ) {
          return {
            type: node.type,
            children: children(node, node.children),
            start: Number.parseInt(listMarker.text, 10),
          };
        }
      }
      // "[ ]" / "[x]" of a task list item: drawn as a checkbox (syntax.css), toggled in editor.ts.
      if (node.type === "task_list_marker_checked" || node.type === "task_list_marker_unchecked") {
        return { type: node.type, children: [source.slice(node.startIndex, node.endIndex)] };
      }
      // <https://...> and <name@host>: a link with "<" ">" as markers.
      if (node.type === "uri_autolink" || node.type === "email_autolink") {
        const text = source.slice(node.startIndex + 1, node.endIndex - 1);
        return {
          type: "inline_link",
          href: node.type === "email_autolink" ? `mailto:${text}` : text,
          children: [{ type: "marker", children: ["<"] }, text, { type: "marker", children: [">"] }],
        };
      }
      // "[^label]": a numbered footnote reference, or the start of its definition ("[^label]:").
      if (node.type === "shortcut_link") {
        const label = /^\[\^([^\]\s]+)\]$/.exec(source.slice(node.startIndex, node.endIndex))?.[1];
        const number = label === undefined ? undefined : footnotes.numbers.get(footnoteKey(label));
        if (label !== undefined && number !== undefined) {
          const definition = footnoteDefinitions.has(node.startIndex);
          return {
            type: definition ? "footnote_definition" : "footnote_reference",
            number,
            // Ctrl+click (links.ts): reference -> its definition, definition -> first reference.
            href: definition ? `#fnref-${number}` : `#fn-${number}`,
            children: [
              { type: "marker", children: ["[^"] },
              { type: "footnote_label", children: [label] },
              { type: "marker", children: ["]"] },
            ],
          };
        }
      }
      // [text][label], [text][] and [text]: a link when the label is defined; brackets are markers.
      if (
        node.type === "full_reference_link" ||
        node.type === "collapsed_reference_link" ||
        node.type === "shortcut_link"
      ) {
        const label = node.namedChildren.find((child) => child.type === "link_label");
        const text = node.namedChildren.find((child) => child.type === "link_text");
        const key = label ? labelKey(label.text.slice(1, -1)) : text && labelKey(text.text);
        const href = key ? definitions.get(key) : undefined;
        if (href !== undefined) {
          return {
            type: "inline_link",
            href,
            children: children({ startIndex: node.startIndex, endIndex: node.endIndex, type: "inline_link" }, node.children),
          };
        }
      }
      if (!node.childCount) return source.slice(node.startIndex, node.endIndex);
      if (node.type === "inline_link") {
        // The target is kept on the element for Ctrl+click and hover previews (editor/links.ts).
        const destination = node.namedChildren.find((child) => child.type === "link_destination");
        return {
          type: node.type,
          href: destination?.text.replace(/^<|>$/g, ""),
          children: children(node, node.children),
        };
      }
      return { type: node.type, children: children(node, node.children) };
    }

    const result = children(blockTree.rootNode, blockTree.rootNode.children);
    hoistContinuations(result);
    for (const tree of inlineTrees) tree.delete();
    inlineTrees = nextInlineTrees;
    return result;
  };
}
