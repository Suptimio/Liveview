// Hovering the document shows the Markdown source line number of that line, faintly, in the
// paper's left margin (same numbering as VS Code's text editor).
export function setupLineHint(editor: HTMLElement, paper: HTMLElement): void {
  const hint = document.createElement("div");
  hint.className = "line-hint";
  hint.setAttribute("aria-hidden", "true");
  hint.hidden = true;
  paper.append(hint);

  let frame = 0;
  const hide = () => {
    cancelAnimationFrame(frame);
    hint.hidden = true;
  };

  editor.addEventListener("pointermove", (event) => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const caret = document.caretRangeFromPoint(event.clientX, event.clientY);
      if (!caret || !editor.contains(caret.startContainer)) return hide();
      const before = document.createRange();
      before.setStart(editor, 0);
      before.setEnd(caret.startContainer, caret.startOffset);
      const caretBox = caret.getBoundingClientRect();
      const paperBox = paper.getBoundingClientRect();
      hint.textContent = String(before.toString().split("\n").length);
      hint.style.top = `${caretBox.height ? caretBox.top + caretBox.height / 2 : event.clientY}px`;
      hint.style.left = `${paperBox.left}px`;
      hint.style.width = `${editor.getBoundingClientRect().left - paperBox.left - 12}px`;
      hint.hidden = false;
    });
  });
  editor.addEventListener("pointerleave", hide);
  window.addEventListener("scroll", hide, true);
}
