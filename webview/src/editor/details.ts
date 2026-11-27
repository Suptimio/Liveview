// Open/closed state of <details> blocks. This is view state only: toggling never edits the
// Markdown. Blocks start like on GitHub (closed, unless written as `<details open>`).
// A pen button (like on HTML blocks) shows the block's HTML tags for editing.
import { icons } from "../icons";

export type DetailsState = {
  /** Re-applies the open state after the editor DOM was patched. */
  sync(): void;
};

export function setupDetails(editor: HTMLElement): DetailsState {
  // Keyed by position in the document (n-th <details>), which survives re-renders.
  const overrides = new Map<number, boolean>();
  const blocks = () => [...editor.querySelectorAll<HTMLElement>('[data-syntax="details"]')];

  function sync(): void {
    for (const [index, block] of blocks().entries()) {
      block.toggleAttribute("data-open", overrides.get(index) ?? block.hasAttribute("data-default-open"));
    }
  }

  // The chevron is drawn in the summary's left padding; a press there toggles,
  // a press on the title text places the caret for editing it.
  editor.addEventListener(
    "pointerdown",
    (event) => {
      const summary = event.target;
      if (!(summary instanceof HTMLElement) || summary.dataset.syntax !== "details_summary") return;
      if (summary.parentElement?.hasAttribute("data-source")) return;
      const padding = Number.parseFloat(getComputedStyle(summary).paddingLeft) || 0;
      if (event.clientX > summary.getBoundingClientRect().left + padding) return;
      const block = summary.parentElement;
      const index = block ? blocks().indexOf(block) : -1;
      if (!block || index === -1) return;
      event.preventDefault();
      event.stopPropagation();
      overrides.set(index, !block.hasAttribute("data-open"));
      sync();
    },
    true,
  );

  // ----- pen: edit the HTML source of a block -----

  const pen = document.createElement("button");
  pen.type = "button";
  pen.className = "details-edit";
  pen.title = "Edit HTML";
  pen.setAttribute("aria-label", "Edit HTML of this collapsible block");
  pen.innerHTML = icons.edit;
  pen.hidden = true;
  document.body.append(pen);
  let penTarget: HTMLElement | null = null;

  function showPen(block: HTMLElement | null): void {
    penTarget = block && !block.hasAttribute("data-source") ? block : null;
    pen.hidden = !penTarget;
    if (!penTarget) return;
    const box = penTarget.getBoundingClientRect();
    pen.style.top = `${box.top}px`;
    pen.style.left = `${box.right - pen.offsetWidth}px`;
  }

  // pointermove (not pointerover): the pen must come back after scrolling without leaving the block.
  editor.addEventListener("pointermove", (event) => {
    const block = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-syntax="details"]') : null;
    if (block !== penTarget || pen.hidden) showPen(block);
  });
  editor.addEventListener("pointerleave", (event) => {
    // relatedTarget may be the icon inside the pen, not the pen itself.
    if (!(event.relatedTarget instanceof Node && pen.contains(event.relatedTarget))) showPen(null);
  });
  pen.addEventListener("pointerleave", (event) => {
    if (!(event.relatedTarget instanceof Node && penTarget?.contains(event.relatedTarget))) showPen(null);
  });
  window.addEventListener("scroll", () => showPen(penTarget), { passive: true });
  // Keep the editor focused while pressing the pen.
  pen.addEventListener("pointerdown", (event) => event.preventDefault());
  pen.addEventListener("click", () => {
    const block = penTarget;
    if (!block) return;
    block.setAttribute("data-source", "");
    showPen(null);
    const first = document.createTreeWalker(block, NodeFilter.SHOW_TEXT).nextNode();
    editor.focus({ preventScroll: true });
    if (first) window.getSelection()?.setPosition(first, 0);
  });

  // Back to the rendered block once the caret leaves it.
  document.addEventListener("selectionchange", () => {
    const focus = window.getSelection()?.focusNode ?? null;
    for (const block of editor.querySelectorAll<HTMLElement>('[data-syntax="details"][data-source]')) {
      if (!focus || !block.contains(focus)) block.removeAttribute("data-source");
    }
  });

  return { sync };
}
