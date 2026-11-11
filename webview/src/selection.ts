function isCaretPlaceholder(node: Node) {
  return Boolean(node.parentElement?.closest("[data-caret-placeholder]"));
}

export function readEditorText(editor: HTMLElement) {
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  let source = "";
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!isCaretPlaceholder(node)) source += node.textContent ?? "";
  }
  return source;
}

export function readSelection(editor: HTMLElement) {
  const selection = window.getSelection();
  if (
    !selection?.anchorNode ||
    !selection.focusNode ||
    !editor.contains(selection.anchorNode) ||
    !editor.contains(selection.focusNode)
  )
    return null;
  function offset(node: Node, offset: number) {
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.setEnd(node, offset);
    const walker = document.createTreeWalker(range.cloneContents(), NodeFilter.SHOW_TEXT);
    let total = 0;
    for (let text = walker.nextNode(); text; text = walker.nextNode()) {
      if (!isCaretPlaceholder(text)) total += text.textContent?.length ?? 0;
    }
    return total;
  }
  return {
    anchor: offset(selection.anchorNode, selection.anchorOffset),
    focus: offset(selection.focusNode, selection.focusOffset),
  };
}

export function restoreSelection(editor: HTMLElement, saved: { anchor: number; focus: number }) {
  function position(offset: number): [Node, number] {
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node instanceof Text && node.textContent) nodes.push(node);
    }
    const placeholder = nodes.find(isCaretPlaceholder);
    const sourceNodes = nodes.filter((node) => !isCaretPlaceholder(node));
    const sourceLength = sourceNodes.reduce((total, node) => total + node.length, 0);
    if (placeholder && offset >= sourceLength) return [placeholder, placeholder.length];
    for (const [index, node] of sourceNodes.entries()) {
      const length = node.textContent?.length ?? 0;
      if (offset < length) return [node, offset];
      if (offset === length) {
        const next = sourceNodes[index + 1] ?? placeholder;
        return next ? [next, 0] : [node, length];
      }
      offset -= length;
    }
    const last = sourceNodes.at(-1);
    if (last) return [last, last.textContent?.length ?? 0];
    if (placeholder) return [placeholder, placeholder.length];
    return [editor, editor.childNodes.length];
  }
  const anchor = position(saved.anchor);
  const focus = position(saved.focus);
  window.getSelection()?.setBaseAndExtent(anchor[0], anchor[1], focus[0], focus[1]);
}

export function revealSyntax(editor: HTMLElement) {
  const active = new Set<HTMLElement>();
  const selection = window.getSelection();
  let focusOffset: number | undefined;
  if (
    document.activeElement === editor &&
    selection?.focusNode &&
    editor.contains(selection.focusNode)
  ) {
    focusOffset = readSelection(editor)?.focus;
    let element =
      selection.focusNode instanceof HTMLElement
        ? selection.focusNode
        : selection.focusNode.parentElement;
    while (element && element !== editor) {
      active.add(element);
      element = element.parentElement;
    }
  }
  if (focusOffset !== undefined) {
    const source = readEditorText(editor);
    const lineStart = source.lastIndexOf("\n", focusOffset - 1) + 1;
    const lineBreak = source.indexOf("\n", focusOffset);
    const lineEnd = lineBreak === -1 ? source.length : lineBreak;
    for (const marker of editor.querySelectorAll<HTMLElement>(
      '[data-syntax="marker"], [data-syntax^="list_marker_"]',
    )) {
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.setEndBefore(marker);
      const start = range.toString().length;
      const end = start + (marker.textContent?.length ?? 0);
      if (start < lineEnd && end > lineStart) active.add(marker);
    }
  }
  for (const element of editor.querySelectorAll<HTMLElement>("[data-active]")) {
    if (!active.has(element)) element.removeAttribute("data-active");
  }
  for (const element of active) {
    if (!element.hasAttribute("data-active")) element.setAttribute("data-active", "");
  }
}
