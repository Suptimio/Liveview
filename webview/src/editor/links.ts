// Links in the document: Ctrl/Cmd+click opens the target (via the extension), hovering a link to
// another Markdown file shows a small rendered paper preview of that file.
import { cloneForExport } from "../host/exporter";
import { onHostMessage, postToHost } from "../host/host";
import { createMarkdown } from "./markdown";
import { patch } from "./vdom";

/** Relative link to a Markdown file, optionally with #anchor or ?query. */
const markdownLink = /^(?![a-z][a-z0-9+.-]*:)[^#?]*\.(?:md|markdown)(?:[#?].*)?$/i;
const hoverDelay = 350;
const hideDelay = 200;

type LinkedFile = { text?: string; baseUri?: string; error?: string };

/**
 * The link under the event. composedPath() also reaches links inside table cells and links
 * whose element still carries a preview's shadow root (e.g. an image whose "!" was deleted).
 */
const links = '[data-syntax="inline_link"][data-href], [data-syntax^="footnote_"][data-href]';

function linkAt(event: Event): HTMLElement | null {
  for (const target of event.composedPath()) {
    if (target instanceof HTMLElement && target.matches(links)) return target;
  }
  return null;
}

/** GitHub's heading anchor: lower case, punctuation dropped, spaces as "-". */
const slug = (text: string) =>
  text.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, "").replace(/\s/g, "-");

/** Scrolls to the heading a "#anchor" link points to (repeated titles get "-1", "-2", like on GitHub). */
function scrollToHeading(editor: HTMLElement, anchor: string): void {
  const counts = new Map<string, number>();
  for (const heading of editor.querySelectorAll<HTMLElement>('[data-syntax="atx_heading"], [data-syntax="setext_heading"]')) {
    let text = "";
    const walker = document.createTreeWalker(heading, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.parentElement?.closest('[data-syntax="marker"], [data-syntax="setext_underline"]')) text += node.textContent;
    }
    const base = slug(text);
    const count = counts.get(base) ?? 0;
    counts.set(base, count + 1);
    if ((count ? `${base}-${count}` : base) === anchor) {
      heading.scrollIntoView({ block: "start" });
      return;
    }
  }
}

const attribute = (value: string) => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;");

export function setupLinks(editor: HTMLElement): void {
  // ----- Ctrl/Cmd + click -----

  editor.addEventListener(
    "pointerdown",
    (event) => {
      const link = linkAt(event);
      if (!link?.dataset.href || event.button !== 0 || !(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      event.stopPropagation();
      const href = link.dataset.href;
      // Footnotes (markdown.ts): "#fn-N" is definition N, "#fnref-N" the first reference to N.
      const footnote = /^#fn(ref)?-(\d+)$/.exec(href);
      if (footnote) {
        const target = footnote[1] ? "footnote_reference" : "footnote_definition";
        editor.querySelector(`[data-syntax="${target}"][data-number="${footnote[2]}"]`)?.scrollIntoView({ block: "center" });
        return;
      }
      if (href.startsWith("#")) {
        let anchor = href.slice(1);
        try {
          anchor = decodeURIComponent(anchor);
        } catch {
          // Keep the raw text when it is not valid percent-encoding.
        }
        scrollToHeading(editor, anchor.toLowerCase());
        return;
      }
      postToHost({ type: "open-link", href });
    },
    true,
  );

  // Pointer cursor on links while Ctrl/Cmd is held, like in VS Code.
  const linkMode = (event: KeyboardEvent | PointerEvent) =>
    editor.classList.toggle("is-link-mode", event.ctrlKey || event.metaKey);
  window.addEventListener("keydown", linkMode);
  window.addEventListener("keyup", linkMode);
  editor.addEventListener("pointermove", linkMode);
  window.addEventListener("blur", () => editor.classList.remove("is-link-mode"));

  // ----- reading linked files through the extension -----

  let nextRequest = 1;
  const pending = new Map<number, (file: LinkedFile) => void>();
  onHostMessage((message) => {
    if (message.type !== "markdown-file") return;
    pending.get(message.id)?.(message);
    pending.delete(message.id);
  });
  const readLinked = (href: string) =>
    new Promise<LinkedFile>((resolve) => {
      const id = nextRequest++;
      pending.set(id, resolve);
      postToHost({ type: "read-markdown", id, href });
    });

  // ----- hover preview -----

  const popup = document.createElement("aside");
  popup.className = "link-preview";
  popup.hidden = true;
  const header = document.createElement("div");
  header.className = "link-preview-header";
  const name = document.createElement("span");
  name.className = "link-preview-name";
  const hint = document.createElement("span");
  hint.textContent = "Ctrl+Click to open";
  header.append(name, hint);
  const body = document.createElement("div");
  body.className = "link-preview-body";
  const frame = document.createElement("iframe");
  frame.title = "Preview of the linked Markdown file";
  frame.setAttribute("sandbox", "");
  const message = document.createElement("p");
  message.className = "link-preview-message";
  body.append(frame, message);
  popup.append(header, body);
  document.body.append(popup);

  let renderer: ReturnType<typeof createMarkdown> | undefined;
  let current: HTMLElement | null = null;
  let request = 0;
  let showTimer: number | undefined;
  let hideTimer: number | undefined;

  /** The linked file rendered with the paper's current CSS, profile and theme. */
  async function renderPaper(text: string, baseUri: string): Promise<string> {
    const markdown = await (renderer ??= createMarkdown());
    const root = document.documentElement;
    const container = document.createElement("div");
    // Images in the linked file are relative to that file.
    const documentBase = root.dataset.documentBase;
    root.dataset.documentBase = baseUri;
    try {
      patch(container, markdown(text));
    } finally {
      if (documentBase === undefined) delete root.dataset.documentBase;
      else root.dataset.documentBase = documentBase;
    }
    for (const details of container.querySelectorAll('[data-syntax="details"]')) {
      details.toggleAttribute("data-open", details.hasAttribute("data-default-open"));
    }
    const shadowStyles = new Set<string>();
    const clone = cloneForExport(container, shadowStyles);
    if (!(clone instanceof HTMLElement)) return "";
    // Table editing buttons are not part of the paper.
    for (const button of clone.querySelectorAll(".table-add-column, .table-add-row, .table-remove-column, .table-remove-row")) {
      button.remove();
    }
    const content = clone.innerHTML;
    const theme = root.dataset.theme === "dark" ? "dark" : "light";
    const css = [...[...document.head.querySelectorAll("style")].map((style) => style.textContent ?? ""), ...shadowStyles]
      .join("\n")
      .replaceAll("<", "\\3C ");
    return `<!doctype html>
<html lang="en" data-profile="${attribute(root.dataset.profile ?? "basic")}" data-theme="${theme}" style="${attribute(root.getAttribute("style") ?? "")}">
<head><meta charset="UTF-8"><style>${css}
html, body { margin: 0; }
.paper { min-height: 100vh; }
#editor { min-height: 0 !important; }</style></head>
<body class="${attribute(document.body.className)}"><section class="paper" data-theme="${theme}"><div id="editor">${content}</div></section></body>
</html>`;
  }

  function position(link: HTMLElement): void {
    const anchor = link.getClientRects()[0] ?? link.getBoundingClientRect();
    const width = popup.offsetWidth;
    const height = popup.offsetHeight;
    let top = anchor.bottom + 8;
    if (top + height > window.innerHeight - 8) top = Math.max(8, anchor.top - height - 8);
    const left = Math.min(Math.max(8, anchor.left), window.innerWidth - width - 8);
    popup.style.top = `${top}px`;
    popup.style.left = `${left}px`;
  }

  async function show(link: HTMLElement): Promise<void> {
    const href = link.dataset.href ?? "";
    const token = ++request;
    current = link;
    const file = await readLinked(href);
    if (token !== request) return;
    name.textContent = href.split(/[#?]/)[0] ?? href;
    if (file.text !== undefined && file.baseUri) {
      frame.srcdoc = await renderPaper(file.text, file.baseUri);
      if (token !== request) return;
      frame.hidden = false;
      message.hidden = true;
    } else {
      frame.hidden = true;
      message.hidden = false;
      message.textContent = file.error ?? "No preview available.";
    }
    popup.hidden = false;
    position(link);
  }

  function hide(): void {
    request++;
    current = null;
    popup.hidden = true;
    frame.srcdoc = "";
  }

  function hideLater(): void {
    window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(hide, hideDelay);
  }

  editor.addEventListener("pointerover", (event) => {
    const link = linkAt(event);
    if (!link || !markdownLink.test(link.dataset.href ?? "")) return;
    window.clearTimeout(hideTimer);
    if (link === current) return;
    window.clearTimeout(showTimer);
    showTimer = window.setTimeout(() => void show(link), hoverDelay);
  });
  editor.addEventListener("pointerout", (event) => {
    const link = linkAt(event);
    if (!link || (event.relatedTarget instanceof Node && link.contains(event.relatedTarget))) return;
    window.clearTimeout(showTimer);
    hideLater();
  });
  // Moving onto the preview keeps it open (to scroll it).
  popup.addEventListener("pointerenter", () => window.clearTimeout(hideTimer));
  popup.addEventListener("pointerleave", hideLater);
  // Typing or scrolling the document closes it (modifier keys don't: Ctrl is needed to click).
  editor.addEventListener("keydown", (event) => {
    if (!["Control", "Meta", "Shift", "Alt"].includes(event.key)) hide();
  });
  window.addEventListener("scroll", () => {
    if (!popup.hidden) hide();
  }, { passive: true });
}
