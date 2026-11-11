import { patchPreview, type Preview } from "./preview";

export type VNode = string | { type: string; children: VNode[]; start?: number; preview?: Preview };

export function patch(parent: HTMLElement, children: VNode[]): void {
  for (const [index, child] of children.entries()) {
    const node = parent.childNodes[index];
    if (typeof child === "string") {
      if (node instanceof Text) {
        if (node.data !== child) node.data = child;
      } else {
        const text = document.createTextNode(child);
        if (node) node.replaceWith(text);
        else parent.append(text);
      }
      continue;
    }
    const span = node instanceof HTMLSpanElement ? node : document.createElement("span");
    if (span !== node) {
      if (node) node.replaceWith(span);
      else parent.append(span);
    }
    if (span.dataset.syntax !== child.type) span.dataset.syntax = child.type;

    if (child.type === "atx_heading" && child.start !== undefined) {
      span.dataset.level = String(child.start);
    } else {
      delete span.dataset.level;
    }

    const counterReset = child.start === undefined ? "" : `markdown-list ${child.start - 1}`;
    if (span.style.counterReset !== counterReset) span.style.counterReset = counterReset;
    patch(span, child.children);
    patchPreview(span, child.preview, patch);
  }
  while (parent.childNodes.length > children.length) parent.lastChild?.remove();
}
