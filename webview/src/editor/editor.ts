// The Markdown editor core: renders the source with tree-sitter, maps DOM edits back to the
// Markdown text and keeps the extension host's document in sync.
import { postToHost, onHostMessage, showFatalError, type EditMessage } from "../host/host";
import { readEditorText, readSelection, restoreSelection, revealSyntax } from "./selection";
import { patch } from "./vdom";
import { resizeTable, type TableResizeAction } from "../actions/table";
import type { EditorContext, EditorSelection } from "../actions/types";
import type { createMarkdown } from "./markdown";

type Markdown = Awaited<ReturnType<typeof createMarkdown>>;

export function createEditor(editor: HTMLElement, markdown: Markdown): EditorContext {
  let health: "ready" | "failed" = "ready";
  let pendingSend: number | undefined;
  let pendingEdit: EditMessage | undefined;
  const outgoingTexts: string[] = [];
  let currentSource = "";
  let documentVersion = 0;
  let renderedActiveLine = -1;
  let tableCellEditing = false;

  function removeCaretPlaceholders(): void {
    for (const placeholder of editor.querySelectorAll("[data-caret-placeholder]")) {
      placeholder.remove();
    }
  }

  function ensureCaretPlaceholder(source: string, offset?: number): void {
    const position = offset ?? (source.endsWith("\n") ? source.length : undefined);
    if (position === undefined) return;
    const lineStart = source.lastIndexOf("\n", position - 1) + 1;
    const lineEndIndex = source.indexOf("\n", position);
    const lineEnd = lineEndIndex === -1 ? source.length : lineEndIndex;
    if (source.slice(lineStart, lineEnd).trim() !== "") return;

    let thematicBreak: HTMLElement | null = null;
    if (lineStart > 0 && lineEnd < source.length) {
      const previousLineEnd = lineStart - 1;
      const previousLineStart = source.lastIndexOf("\n", previousLineEnd - 1) + 1;
      const previousLine = source.slice(previousLineStart, previousLineEnd);
      if (/^[ \t]{0,3}(?:-[ \t]*){3,}$/.test(previousLine)) {
        thematicBreak =
          [...editor.querySelectorAll<HTMLElement>('[data-syntax="thematic_break"]')].find(
            (element) => {
              const range = document.createRange();
              range.selectNodeContents(editor);
              range.setEndBefore(element);
              return range.toString().length === previousLineStart;
            },
          ) ?? null;
      }
    }

    const placeholder = document.createElement("span");
    placeholder.dataset.caretPlaceholder = "";
    placeholder.dataset.caretOffset = String(position);
    placeholder.setAttribute("aria-hidden", "true");
    placeholder.textContent = "\u200b";

    if (thematicBreak?.parentNode) {
      placeholder.dataset.caretBlock = "";
      thematicBreak.parentNode.insertBefore(placeholder, thematicBreak.nextSibling);
      return;
    }

    if (position === source.length) {
      editor.append(placeholder);
      return;
    }

    let remaining = position;
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!(node instanceof Text)) continue;
      if (remaining > node.length) {
        remaining -= node.length;
        continue;
      }
      const before = remaining === node.length ? node.nextSibling : node.splitText(remaining);
      node.parentNode?.insertBefore(placeholder, before);
      return;
    }
    editor.append(placeholder);
  }

  function update(source = readEditorText(editor), selection = readSelection(editor)): void {
    removeCaretPlaceholders();
    const activeOffset = document.activeElement === editor ? selection?.focus : undefined;
    patch(editor, markdown(source, activeOffset));
    currentSource = source;
    ensureCaretPlaceholder(source, selection?.focus);
    if (selection) {
      selection = {
        anchor: Math.min(selection.anchor, source.length),
        focus: Math.min(selection.focus, source.length),
      };
      restoreSelection(editor, selection);
    }
    renderedActiveLine =
      activeOffset === undefined ? -1 : source.lastIndexOf("\n", activeOffset - 1) + 1;
    revealSyntax(editor);
    if (selection) restoreSelection(editor, selection);
  }

  function sendEdit(previousText: string, text: string): void {
    if (pendingEdit) pendingEdit.text = text;
    else pendingEdit = { type: "edit", previousText, text };
    window.clearTimeout(pendingSend);
    pendingSend = window.setTimeout(() => {
      pendingSend = undefined;
      if (pendingEdit) {
        outgoingTexts.push(pendingEdit.text);
        postToHost(pendingEdit);
      }
      pendingEdit = undefined;
    }, 100);
  }

  function localChange(source = readEditorText(editor), selection = readSelection(editor)): void {
    if (editor.contentEditable !== "true") return;
    const previousText = currentSource;
    if (source === previousText) return;
    update(source, selection);
    sendEdit(previousText, source);
  }

  function fail(error: unknown): void {
    health = "failed";
    showFatalError(editor, error, "Markdown editor failed.");
  }

  function replaceText(start: number, end: number, text: string, caret = start + text.length): void {
    const source = currentSource;
    try {
      localChange(source.slice(0, start) + text + source.slice(end), {
        anchor: caret,
        focus: caret,
      });
    } catch (error) {
      fail(error);
    }
  }

  function insertText(text: string): void {
    if (editor.contentEditable !== "true") return;
    const selection = readSelection(editor);
    if (!selection) return;
    const start = Math.min(selection.anchor, selection.focus);
    const end = Math.max(selection.anchor, selection.focus);
    replaceText(start, end, text);
  }

  function insertParagraph(): void {
    const selection = readSelection(editor);
    if (!selection) {
      insertText("\n");
      return;
    }

    const start = Math.min(selection.anchor, selection.focus);
    const end = Math.max(selection.anchor, selection.focus);
    const lineStart = currentSource.lastIndexOf("\n", start - 1) + 1;
    const nextLineBreak = currentSource.indexOf("\n", start);
    const lineEnd = nextLineBreak === -1 ? currentSource.length : nextLineBreak;
    const line = currentSource.slice(lineStart, lineEnd);
    const quotePrefix = line.match(/^[ \t]{0,3}(?:>[ \t]?)+/)?.[0];
    if (!quotePrefix) {
      insertText("\n");
      return;
    }

    if (start === end && !line.slice(quotePrefix.length).trim()) {
      const replaceEnd = lineEnd < currentSource.length ? lineEnd + 1 : lineEnd;
      replaceText(lineStart, replaceEnd, "\n", lineStart + 1);
      return;
    }

    insertText(`\n${quotePrefix}`);
  }

  function materializeLazyBlockQuote(): void {
    const selection = readSelection(editor);
    const focusNode = window.getSelection()?.focusNode;
    if (!selection || selection.anchor !== selection.focus || !focusNode) return;

    let element = focusNode instanceof Element ? focusNode : focusNode.parentElement;
    let quoteDepth = 0;
    while (element && element !== editor) {
      if (element.getAttribute("data-syntax") === "block_quote") quoteDepth++;
      element = element.parentElement;
    }
    if (!quoteDepth) return;

    const lineStart = currentSource.lastIndexOf("\n", selection.focus - 1) + 1;
    const nextLineBreak = currentSource.indexOf("\n", selection.focus);
    const lineEnd = nextLineBreak === -1 ? currentSource.length : nextLineBreak;
    const line = currentSource.slice(lineStart, lineEnd);
    const indentation = line.match(/^[ \t]{0,3}/)?.[0] ?? "";
    if (line.slice(indentation.length).startsWith(">")) return;

    const marker = "> ".repeat(quoteDepth);
    const insertAt = lineStart + indentation.length;
    const moveOffset = (offset: number) => (offset >= insertAt ? offset + marker.length : offset);
    localChange(
      `${currentSource.slice(0, insertAt)}${marker}${currentSource.slice(insertAt)}`,
      { anchor: moveOffset(selection.anchor), focus: moveOffset(selection.focus) },
    );
  }

  update("");
  editor.contentEditable = "true";
  editor.setAttribute("aria-readonly", "false");

  onHostMessage((message) => {
    if (message.type === "document") {
      if (message.version < documentVersion) return;
      documentVersion = message.version;
      document.documentElement.dataset.documentBase = message.baseUri;
      const acknowledgedIndex = outgoingTexts.indexOf(message.text);
      if (acknowledgedIndex !== -1) {
        outgoingTexts.splice(0, acknowledgedIndex + 1);
        return;
      }
      if (message.text === currentSource) return;
      outgoingTexts.length = 0;
      window.clearTimeout(pendingSend);
      pendingSend = undefined;
      pendingEdit = undefined;
      try {
        update(message.text);
      } catch (error) {
        fail(error);
      }
    }
  });
  postToHost({ type: "ready" });

  editor.addEventListener("input", (event: InputEvent) => {
    if (event.isComposing || health !== "ready") return;
    try {
      localChange();
    } catch (error) {
      fail(error);
    }
  });
  editor.addEventListener("table-cell-focus", () => {
    tableCellEditing = true;

    if (renderedActiveLine === -1) return;

    renderedActiveLine = -1;

    removeCaretPlaceholders();
    patch(editor, markdown(currentSource));
    ensureCaretPlaceholder(currentSource);
    revealSyntax(editor);
  });
  editor.addEventListener("table-cell-blur", () => {
    tableCellEditing = false;
  });
  editor.addEventListener("table-cell-input", (event) => {
    const detail = (event as CustomEvent<{
      start: number;
      end: number;
      text: string;
    }>).detail;
    if (
      !Number.isInteger(detail?.start) ||
      !Number.isInteger(detail.end) ||
      detail.start < 0 ||
      detail.end < detail.start
    )
      return;
    tableCellEditing = true;
    const escape = (text: string) => text.replaceAll("|", "\\|").replaceAll("\n", " ");
    const host = event.target;
    if (!(host instanceof HTMLElement)) return;
    const tableStart = Number(host.dataset.sourceStart);
    const tableEnd = Number(host.dataset.sourceEnd);
    if (
      !Number.isInteger(tableStart) ||
      !Number.isInteger(tableEnd) ||
      detail.start < tableStart ||
      detail.end > tableEnd
    )
      return;
    const replacement = ` ${escape(detail.text.trim())} `;
    const previousText = currentSource;
    const nextSource =
      currentSource.slice(0, detail.start) + replacement + currentSource.slice(detail.end);
    const delta = replacement.length - (detail.end - detail.start);
    if (nextSource === previousText) return;

    const ranges = [
      ...editor.querySelectorAll<HTMLElement>("[data-source-start][data-source-end]"),
      ...(host.shadowRoot?.querySelectorAll<HTMLElement>(
        "[data-source-start][data-source-end]",
      ) ?? []),
    ];
    for (const range of ranges) {
      const start = Number(range.dataset.sourceStart);
      const end = Number(range.dataset.sourceEnd);
      if (start >= detail.end) {
        range.dataset.sourceStart = String(start + delta);
        range.dataset.sourceEnd = String(end + delta);
      } else if (end >= detail.end) {
        range.dataset.sourceEnd = String(end + delta);
      }
    }
    currentSource = nextSource;
    const updatedTableEnd = tableEnd + delta;
    host.dataset.sourceEnd = String(updatedTableEnd);
    host.textContent = currentSource.slice(tableStart, updatedTableEnd);
    sendEdit(previousText, currentSource);
  });
  editor.addEventListener("table-resize", (event) => {
    const detail = (event as CustomEvent<{
      action: TableResizeAction;
    }>).detail;
    const target = event.target;
    if (
      !(target instanceof HTMLElement) ||
      !Number.isInteger(Number(target.dataset.sourceStart))
    )
      return;
    const start = Number(target.dataset.sourceStart);
    if (start < 0 || start >= currentSource.length) return;
    let end = start;
    while (end < currentSource.length) {
      const lineEnd = currentSource.indexOf("\n", end);
      const line = currentSource.slice(end, lineEnd === -1 ? currentSource.length : lineEnd);
      if (!/^[ \t]*\|/.test(line)) break;
      end = lineEnd === -1 ? currentSource.length : lineEnd + 1;
    }
    if (end === start) return;
    try {
      localChange(
        currentSource.slice(0, start) +
        resizeTable(currentSource.slice(start, end), detail.action) +
        currentSource.slice(end),
        null,
      );
    } catch (error) {
      fail(error);
    }
  });
  editor.addEventListener("compositionend", () => {
    try {
      localChange();
    } catch (error) {
      fail(error);
    }
  });
  editor.addEventListener("beforeinput", (event: InputEvent) => {
    if (editor.contentEditable !== "true") {
      event.preventDefault();
      return;
    }
    if (event.isComposing) return;
    if (event.inputType === "insertText" || event.inputType === "insertReplacementText") {
      event.preventDefault();
      insertText(event.data ?? "");
    } else if (event.inputType === "insertParagraph" || event.inputType === "insertLineBreak") {
      event.preventDefault();
      insertParagraph();
    } else if (event.inputType.startsWith("delete")) {
      const range = event.getTargetRanges()[0];
      if (range) {
        event.preventDefault();
        window
          .getSelection()
          ?.setBaseAndExtent(
            range.startContainer,
            range.startOffset,
            range.endContainer,
            range.endOffset,
          );
        insertText("");
      }
    } else if (event.inputType.startsWith("format")) {
      event.preventDefault();
    }
  });
  editor.addEventListener("paste", (event: ClipboardEvent) => {
    event.preventDefault();
    insertText(event.clipboardData?.getData("text/plain").replaceAll("\r\n", "\n") ?? "");
  });
  editor.addEventListener("pointerup", materializeLazyBlockQuote);
  editor.addEventListener(
    "pointerdown",
    (event) => {
      const isTableCell = event.composedPath().some(
        (target) =>
          target instanceof HTMLElement &&
          (target.matches("td[contenteditable='true']") ||
            target.matches("th[contenteditable='true']")),
      );

      tableCellEditing = isTableCell;
    },
    true,
  );
  editor.addEventListener("drop", (event) => event.preventDefault());
  editor.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") {
      event.preventDefault();
      window.getSelection()?.setBaseAndExtent(editor, 0, editor, editor.childNodes.length);
    }
  });
  function syncActiveLine(): void {
    if (tableCellEditing) return;
    const selection = readSelection(editor);
    const activeLine =
      document.activeElement === editor && selection
        ? currentSource.lastIndexOf("\n", selection.focus - 1) + 1
        : -1;
    if (activeLine === renderedActiveLine) {
      revealSyntax(editor);
      return;
    }

    renderedActiveLine = activeLine;
    const focus = activeLine === -1 ? undefined : selection?.focus;
    removeCaretPlaceholders();
    patch(editor, markdown(currentSource, focus));
    ensureCaretPlaceholder(currentSource, selection?.focus);
    if (selection) restoreSelection(editor, selection);
    revealSyntax(editor);
    if (selection) restoreSelection(editor, selection);
  }

  editor.addEventListener("pointerdown", (event: PointerEvent) => {
    if (!(event.target instanceof Element)) return;
    const rule = event.target.closest<HTMLElement>('[data-syntax="thematic_break"]');
    if (!rule || !editor.contains(rule)) return;
    const text = document.createTreeWalker(rule, NodeFilter.SHOW_TEXT).nextNode();
    if (!(text instanceof Text)) return;

    event.preventDefault();
    editor.focus();
    const bounds = rule.getBoundingClientRect();
    const textRange = document.createRange();
    textRange.selectNodeContents(text);
    const textBounds = textRange.getBoundingClientRect();
    const width = textBounds.width || bounds.width;
    const left = textBounds.width ? textBounds.left : bounds.left;
    const position =
      width === 0
        ? 0
        : Math.round(
          (Math.max(0, Math.min(event.clientX - left, width)) / width) *
          text.length,
        );
    window.getSelection()?.setBaseAndExtent(text, position, text, position);
    syncActiveLine();
  });
  document.addEventListener("selectionchange", syncActiveLine);
  editor.addEventListener("focus", syncActiveLine);
  editor.addEventListener("blur", syncActiveLine);
  editor.addEventListener("keydown", (event) => {
    /*
    if (event.key === "Enter") {
      event.preventDefault();
      const selection = readSelection(editor);
      if (!selection) return;
      const start = Math.min(selection.anchor, selection.focus);
      const end = Math.max(selection.anchor, selection.focus);
      const lineStart = currentSource.lastIndexOf("\n", start - 1) + 1;
      const nextLineBreak = currentSource.indexOf("\n", end);
      const lineEnd = nextLineBreak === -1 ? currentSource.length : nextLineBreak;
      const line = currentSource.slice(lineStart, lineEnd);
      const list = line.match(/^([ \t]*)([-+*])[ \t]+/);
      if (!event.shiftKey && start === end && list && !line.slice(list[0].length).trim()) {
        const lineEnding = lineEnd < currentSource.length ? 1 : 0;
        replaceText(lineStart, lineEnd + lineEnding, "");
        return;
      }
      const continuation =
        !event.shiftKey && list && line.slice(list[0].length).trim()
          ? `\n${list[1]}${list[2]} `
          : "\n";
      replaceText(start, end, continuation);
      return;
    }
    */
    if (event.key !== "Tab") return;
    const selection = readSelection(editor);
    if (!selection || selection.anchor !== selection.focus) return;
    const offset = selection.focus;
    const lineStart = currentSource.lastIndexOf("\n", offset - 1) + 1;
    const lineEndIndex = currentSource.indexOf("\n", offset);
    const lineEnd = lineEndIndex === -1 ? currentSource.length : lineEndIndex;
    const line = currentSource.slice(lineStart, lineEnd);
    if (!/^([ \t]*)([-+*])[ \t]+/.test(line)) return;
    event.preventDefault();
    if (event.shiftKey) {
      const indentation = line.match(/^[ \t]*/)?.[0] ?? "";
      const remove = indentation.startsWith("\t") ? 1 : indentation.startsWith("  ") ? 2 : 0;
      if (remove) replaceText(lineStart, lineStart + remove, "", offset - remove);
    } else {
      replaceText(lineStart, lineStart, "  ", offset + 2);
    }
  });

  // ----- API for actions (tool menu) -----

  // Menus take focus away from the editor; remember where the caret was.
  let lastSelection: EditorSelection | null = null;
  document.addEventListener("selectionchange", () => {
    const selection = readSelection(editor);
    if (selection) lastSelection = selection;
  });

  return {
    source: () => currentSource,
    selection() {
      const selection = readSelection(editor) ?? lastSelection;
      if (!selection) return null;
      return {
        anchor: Math.min(selection.anchor, currentSource.length),
        focus: Math.min(selection.focus, currentSource.length),
      };
    },
    replace(start, end, text, caret) {
      if (document.activeElement !== editor) editor.focus({ preventScroll: true });
      replaceText(start, end, text, caret);
    },
  };
}
