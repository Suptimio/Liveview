import syntaxStyle from "../paper/syntax.css?inline";
import previewStyle from "./preview.css?inline";
import { icons } from "../icons";
import type { VNode } from "./vdom";

export type Preview =
  | { kind: "image"; src: string; alt: string }
  | { kind: "html"; source: string }
  | {
    kind: "table";
    rows: VNode[];
    align: ("left" | "center" | "right")[];
    start: number;
    end: number;
  };

const previews = new WeakMap<HTMLElement, string>();

function editSource(host: HTMLElement) {
  const editor = host.closest('[contenteditable="true"]');
  if (!(editor instanceof HTMLElement)) return;
  editor.focus();
  window.getSelection()?.setPosition(host.firstChild ?? host, 0);
}

/**
 * A click on rendered HTML opens its source, like an image, unless it hits something interactive
 * in it (link, button, the edit pen, <summary>, form field) or the HTML is a <details> title.
 */
function keepsClick(event: Event, host: HTMLElement): boolean {
  if (host.closest('[data-syntax="details_label"]')) return true;
  for (const target of event.composedPath()) {
    if (target === host) return false;
    if (target instanceof Element && target.matches("a[href], button, summary, input, select, textarea, label, video, audio")) {
      return true;
    }
  }
  return false;
}

export function patchPreview(
  host: HTMLElement,
  preview: Preview | undefined,
  patch: (parent: HTMLElement, children: VNode[]) => void,
) {
  if (!preview) {
    if (!previews.has(host)) return;
    host.shadowRoot?.replaceChildren(document.createElement("slot"));
    host.removeAttribute("data-preview");
    delete host.dataset.sourceStart;
    delete host.dataset.sourceEnd;
    previews.delete(host);
    return;
  }
  const key = JSON.stringify(preview);
  host.dataset.preview = preview.kind;
  if (preview.kind === "table") {
    host.dataset.sourceStart = String(preview.start);
    host.dataset.sourceEnd = String(preview.end);
  } else {
    delete host.dataset.sourceStart;
    delete host.dataset.sourceEnd;
  }
  if (previews.get(host) === key) return;
  const root = host.shadowRoot ?? host.attachShadow({ mode: "open" });
  if (!host.shadowRoot?.childNodes.length) {
    // On mousedown, not click: the browser's own caret placement (and the re-render it causes)
    // can move things between press and release, and then no click event fires at all.
    host.addEventListener("mousedown", (event) => {
      if (
        event.button !== 0 ||
        event.ctrlKey ||
        event.metaKey ||
        !host.hasAttribute("data-preview") ||
        host.dataset.preview === "table" ||
        (host.dataset.preview === "html" && keepsClick(event, host)) ||
        host.hasAttribute("data-active")
      )
        return;
      event.preventDefault();
      editSource(host);
    });
    for (const type of ["beforeinput", "input", "keydown", "paste", "compositionend", "drop"]) {
      root.addEventListener(type, (event) => {
        if (event.target instanceof Node && root.contains(event.target)) event.stopPropagation();
      });
    }
  }
  previews.set(host, key);
  const style = document.createElement("style");
  style.textContent = syntaxStyle + previewStyle;
  const source = document.createElement("span");
  source.className = "source";
  source.append(document.createElement("slot"));
  const output = document.createElement("span");
  output.className = "preview";
  output.contentEditable = "false";
  let decoration = output;
  if (preview.kind === "html") {
    const html = document.createElement("span");
    html.attachShadow({ mode: "open" }).innerHTML = preview.source;
    output.append(html);
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "edit-html";
    edit.setAttribute("aria-label", "Edit HTML");
    edit.title = "Edit HTML";
    edit.innerHTML = icons.edit;
    edit.addEventListener("click", (event) => {
      event.stopPropagation();
      editSource(host);
    });
    decoration = document.createElement("span");
    decoration.className = "html-preview";
    decoration.append(output, edit);
  } else if (preview.kind === "image") {
    const baseUri = document.documentElement.dataset.documentBase ?? document.baseURI;
    const base = new URL(baseUri);
    const url = URL.canParse(preview.src, base) ? new URL(preview.src, base) : null;
    if (
      url &&
      (url.protocol === "https:" ||
        url.protocol === "http:" ||
        (url.protocol === base.protocol && url.host === base.host))
    ) {
      const image = document.createElement("img");
      image.alt = preview.alt;
      image.referrerPolicy = "no-referrer";
      image.src = url.href;
      image.addEventListener("error", () => {
        const missing = document.createElement("span");
        missing.className = "image-missing";
        missing.innerHTML = icons["image-missing"];
        missing.append(`Could not load image: ${preview.src}`);
        image.replaceWith(missing);
      });
      output.append(image);
    } else {
      output.textContent = "Image URLs must use HTTP or HTTPS.";
    }
  } else {
    const wrapper = document.createElement("span");
    wrapper.className = "table-wrapper";
    const table = document.createElement("table");
    for (const row of preview.rows) {
      if (
        typeof row === "string" ||
        (row.type !== "pipe_table_header" && row.type !== "pipe_table_row")
      )
        continue;
      const tr = document.createElement("tr");
      let index = 0;
      for (const cell of row.children) {
        if (typeof cell === "string" || cell.type !== "pipe_table_cell") continue;
        const td = document.createElement(row.type === "pipe_table_header" ? "th" : "td");
        td.style.textAlign = preview.align[index++] ?? "left";
        const range = cell.sourceRange;
        if (range) {
          td.dataset.sourceStart = String(range.start);
          td.dataset.sourceEnd = String(range.end);
        }
        td.contentEditable = "true";
        td.spellcheck = false;
        td.addEventListener("focus", () => {
          host.dispatchEvent(new CustomEvent("table-cell-focus", { bubbles: true, composed: true }));
        });
        td.addEventListener("blur", (event) => {
          if (event.relatedTarget instanceof Node && table.contains(event.relatedTarget)) return;
          host.dispatchEvent(new CustomEvent("table-cell-blur", { bubbles: true, composed: true }));
        });
        td.addEventListener("input", () => {
          const start = Number(td.dataset.sourceStart);
          const end = Number(td.dataset.sourceEnd);
          host.dispatchEvent(
            new CustomEvent("table-cell-input", {
              bubbles: true,
              composed: true,
              detail: { start, end, text: plainText(td) },
            }),
          );
        });
        td.addEventListener("beforeinput", (event) => {
          if (event.inputType === "insertParagraph" || event.inputType === "insertLineBreak") {
            event.preventDefault();
          }
        });
        td.addEventListener("keydown", (event) => {
          if (event.key !== "Tab" && event.key !== "Enter") return;
          event.preventDefault();
          const cells = [...table.querySelectorAll<HTMLElement>("th, td")];
          const current = cells.indexOf(td);
          const next = cells[current + (event.shiftKey ? -1 : 1)];
          next?.focus();
        });
        patch(td, cell.children);
        trimCellPadding(td);
        tr.append(td);
      }
      table.append(tr);
    }
    const addColumn = document.createElement("button");
    addColumn.type = "button";
    addColumn.className = "table-add-column";
    addColumn.textContent = "+";
    addColumn.setAttribute("aria-label", "Add table column");
    addColumn.title = "Add column";
    addColumn.addEventListener("click", () => {
      host.dispatchEvent(
        new CustomEvent("table-resize", {
          bubbles: true,
          composed: true,
          detail: { action: "column" },
        }),
      );
    });
    const removeColumn = document.createElement("button");
    removeColumn.type = "button";
    removeColumn.className = "table-remove-column";
    removeColumn.textContent = "-";
    removeColumn.setAttribute("aria-label", "Remove table column");
    removeColumn.title = "Remove column";
    removeColumn.addEventListener("click", () => {
      host.dispatchEvent(
        new CustomEvent("table-resize", {
          bubbles: true,
          composed: true,
          detail: { action: "remove-column" },
        }),
      );
    });
    const addRow = document.createElement("button");
    addRow.type = "button";
    addRow.className = "table-add-row";
    addRow.textContent = "+";
    addRow.setAttribute("aria-label", "Add table row");
    addRow.title = "Add row";
    addRow.addEventListener("click", () => {
      host.dispatchEvent(
        new CustomEvent("table-resize", {
          bubbles: true,
          composed: true,
          detail: { action: "row" },
        }),
      );
    });
    const removeRow = document.createElement("button");
    removeRow.type = "button";
    removeRow.className = "table-remove-row";
    removeRow.textContent = "-";
    removeRow.setAttribute("aria-label", "Remove table row");
    removeRow.title = "Remove row";
    removeRow.addEventListener("click", () => {
      host.dispatchEvent(
        new CustomEvent("table-resize", {
          bubbles: true,
          composed: true,
          detail: { action: "remove-row" },
        }),
      );
    });
    wrapper.append(table, addColumn, removeColumn, addRow, removeRow);
    output.append(wrapper);
  }
  root.replaceChildren(style, source, decoration);
}

/**
 * The cell source range includes the Markdown padding (`| alpha |` -> " alpha ").
 * Showing those spaces puts invisible positions in front of / behind the text, so
 * End, clicks after the text and double-clicks land the caret on a space.
 * Input is trimmed and re-padded in main.ts, so dropping them here is lossless.
 */
function trimCellPadding(cell: HTMLElement): void {
  const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node instanceof Text) texts.push(node);
  }
  for (const text of texts) {
    text.data = text.data.replace(/^[ \t]+/, "");
    if (text.data) break;
  }
  for (const text of texts.reverse()) {
    text.data = text.data.replace(/[ \t]+$/, "");
    if (text.data) break;
  }
}

function plainText(root: Node): string {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let text = "";
  // Markers ("**", "[", "](url)") are part of the cell's Markdown: dropping them loses formatting.
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    text += node.textContent ?? "";
  }
  return text.replaceAll("\n", " ");
}
