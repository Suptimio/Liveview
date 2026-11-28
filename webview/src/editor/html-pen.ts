// One "edit HTML" pen at the right edge of a hovered line that contains inline HTML (<sup>, <kbd>,
// ...), instead of a pen after every element. It opens the source of the line's first HTML element.
import { icons } from "../icons";

const blocks = '[data-syntax="paragraph"], [data-syntax="atx_heading"], [data-syntax="setext_heading"], [data-syntax="list_item"]';

export function setupInlineHtmlPen(editor: HTMLElement, paper: HTMLElement): void {
  const pen = document.createElement("button");
  pen.type = "button";
  pen.className = "html-line-edit";
  pen.title = "Edit HTML";
  pen.setAttribute("aria-label", "Edit HTML");
  pen.innerHTML = icons.edit;
  pen.hidden = true;
  paper.append(pen);

  let html: HTMLElement | null = null;

  paper.addEventListener("pointermove", (event) => {
    if (event.target === pen || pen.contains(event.target as Node)) {return;}
    let block: HTMLElement | null = null;
    for (const target of event.composedPath()) {
      if (target === editor) {break;}
      if (target instanceof HTMLElement && target.matches(blocks)) {
        block = target;
        break;
      }
    }
    // On the way from the text to the pen (right of the text, same line height) it stays.
    if (!block && !pen.hidden) {
      const top = Number.parseFloat(pen.style.top);
      if (event.clientX > editor.getBoundingClientRect().left && Math.abs(event.clientY - top) < 14) {return;}
    }
    html = block?.querySelector<HTMLElement>('[data-syntax="html_inline"]:not([data-active])') ?? null;
    if (!block || !html) {
      pen.hidden = true;
      return;
    }
    const line = block.getClientRects()[0] ?? block.getBoundingClientRect();
    pen.style.top = `${line.top + line.height / 2}px`;
    pen.style.left = `${editor.getBoundingClientRect().right + 8}px`;
    pen.hidden = false;
  });
  paper.addEventListener("pointerleave", () => (pen.hidden = true));
  window.addEventListener("scroll", () => (pen.hidden = true), true);

  // mousedown (not click) keeps the editor's focus and caret handling simple: put the caret into the source.
  pen.addEventListener("mousedown", (event) => {
    event.preventDefault();
    if (!html?.isConnected) {return;}
    editor.focus();
    window.getSelection()?.setPosition(html.firstChild ?? html, 0);
    pen.hidden = true;
  });
}
