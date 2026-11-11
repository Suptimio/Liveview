import syntaxStyle from "./syntax.css?inline";
import previewStyle from "./preview.css?inline";
import editIcon from "./edit.svg?raw";
import type { VNode } from "./vdom";

export type Preview =
  | { kind: "image"; src: string; alt: string }
  | { kind: "html"; source: string }
  | { kind: "table"; rows: VNode[]; align: ("left" | "center" | "right")[] };

const previews = new WeakMap<HTMLElement, string>();

function editSource(host: HTMLElement) {
  const editor = host.closest('[contenteditable="true"]');
  if (!(editor instanceof HTMLElement)) return;
  editor.focus();
  window.getSelection()?.setPosition(host.firstChild ?? host, 0);
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
    previews.delete(host);
    return;
  }
  const key = JSON.stringify(preview);
  if (previews.get(host) === key) return;
  const root = host.shadowRoot ?? host.attachShadow({ mode: "open" });
  if (!host.shadowRoot?.childNodes.length) {
    host.addEventListener("click", () => {
      if (
        !host.hasAttribute("data-preview") ||
        host.dataset.preview === "html" ||
        host.hasAttribute("data-active")
      )
        return;
      editSource(host);
    });
    for (const type of ["beforeinput", "input", "keydown", "paste", "compositionend", "drop"]) {
      root.addEventListener(type, (event) => {
        if (event.target instanceof Node && root.contains(event.target)) event.stopPropagation();
      });
    }
  }
  previews.set(host, key);
  host.dataset.preview = preview.kind;
  const style = document.createElement("style");
  style.textContent = syntaxStyle + previewStyle;
  const source = document.createElement("span");
  source.className = "source";
  source.append(document.createElement("slot"));
  const output = document.createElement("span");
  output.className = "preview";
  output.contentEditable = "false";
  output.inert = preview.kind !== "html";
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
    edit.innerHTML = editIcon;
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
        image.replaceWith(document.createTextNode(`Could not load image: ${preview.src}`));
      });
      output.append(image);
    } else {
      output.textContent = "Image URLs must use HTTP or HTTPS.";
    }
  } else {
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
        patch(td, cell.children);
        tr.append(td);
      }
      table.append(tr);
    }
    output.append(table);
  }
  root.replaceChildren(style, source, decoration);
}
