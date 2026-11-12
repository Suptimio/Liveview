import { createMarkdown } from "./markdown";
import { readEditorText, readSelection, restoreSelection, revealSyntax } from "./selection";
import { patch } from "./vdom";
import { isRenderProfile, setRenderProfile, type RenderProfile } from "./profiles";
import { setTheme } from "./theme";
import githubProfileCss from "./profiles/github.css?inline";
import gitlabProfileCss from "./profiles/gitlab.css?inline";
import vscodeProfileCss from "./profiles/vscode.css?inline";
import "./style.css";
import "./ui.css";

const profileCss: Record<RenderProfile, string> = {
  basic: "",
  github: githubProfileCss,
  gitlab: gitlabProfileCss,
  vscode: vscodeProfileCss,
};

type HostMessage =
  | { type: "document"; text: string; baseUri: string; version: number }
  | { type: "stylesheets"; stylesheets: { name: string; text: string }[] };

type EditMessage = { type: "edit"; previousText: string; text: string };
type ExtensionMessage = EditMessage | { type: "ready" } | { type: "error"; message: string };
type WebviewState = {
  profile?: RenderProfile;
  customCss?: string;
  cssDraft?: string;
};

declare function acquireVsCodeApi(): {
  postMessage(message: ExtensionMessage): void;
  getState(): WebviewState | undefined;
  setState(state: WebviewState): void;
};

const exampleCss = `:root {
  --content-width: 860px;
  --content-font-size: 16px;
  --content-line-height: 1.65;
  --paper-padding: 32px;
  --paper-border: 1px solid #d0d7de;
  --paper-border-radius: 14px;
  --paper-shadow: 0 12px 30px rgb(31 35 40 / 12%);
}

#editor [data-syntax="atx_heading"][data-level="1"] {
  letter-spacing: -0.035em;
}

#editor [data-syntax="block_quote"] {
  border-left: 4px solid var(--accent);
  padding-left: 1em;
}

#editor [data-syntax="code_span"] {
  padding: 0.15em 0.4em;
}`;

const previewBaseCss = `
:root {
  --background: #ffffff;
  --foreground: #24292f;
  --heading: #1f2328;
  --muted: #656d76;
  --surface: #f6f8fa;
  --border: #d1d9e0;
  --accent: #0969da;
  --code: #8250df;
  --content-font-size: 16px;
  --content-line-height: 1.6;
  --paper-padding: 24px;
  --paper-border: 1px solid var(--border);
  --paper-border-radius: 6px;
  --paper-shadow: none;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 14px;
  background: #eef0f3;
  color: var(--foreground);
  font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
body[data-theme="dark"] { background: #15191f; }
.paper {
  min-height: 270px;
  padding: var(--paper-padding);
  border: var(--paper-border);
  border-radius: var(--paper-border-radius);
  background: var(--background);
  color: var(--foreground);
  box-shadow: var(--paper-shadow);
}
.paper[data-theme="dark"] {
  --background: #0d1117;
  --foreground: #e6edf3;
  --heading: #f0f6fc;
  --muted: #9198a1;
  --surface: #161b22;
  --border: #30363d;
  --accent: #44f8a1;
  --code: #d2a8ff;
}
#editor {
  font-size: var(--content-font-size);
  line-height: var(--content-line-height);
}
[data-syntax="atx_heading"] { color: var(--heading); font-weight: 650; }
[data-syntax="atx_heading"][data-level="1"] { font-size: 2em; line-height: 1.25; }
[data-syntax="strong_emphasis"] { color: var(--heading); font-weight: 700; }
[data-syntax="emphasis"] { font-style: italic; }
[data-syntax="block_quote"] { color: var(--muted); font-style: italic; }
[data-syntax="code_span"], [data-syntax="fenced_code_block"] {
  border-radius: 4px;
  background: var(--surface);
  color: var(--code);
  font-family: ui-monospace, monospace;
}
[data-syntax="inline_link"] { color: var(--accent); text-decoration: underline; }
[data-syntax="thematic_break"] { border: 0; border-top: 1px solid var(--border); }
li { margin: 0.2em 0; }
table { border-collapse: collapse; }
th, td { padding: 5px 9px; border: 1px solid var(--border); }
`;

const previewMarkup = `<section class="paper" data-theme="light">
  <div id="editor">
    <h1 data-syntax="atx_heading" data-level="1">A little paper preview</h1>
    <p>A <span data-syntax="strong_emphasis">styled document</span> with <span data-syntax="emphasis">Markdown</span> content.</p>
    <p>Links, <span data-syntax="inline_link">code spans</span>, and more can be styled here.</p>
    <blockquote data-syntax="block_quote">A quote gives the CSS something else to work with.</blockquote>
    <p>Example code: <code data-syntax="code_span">const style = "yours";</code></p>
    <ul><li>Headings and text</li><li>Lists and quotes</li><li>Tables and code</li></ul>
    <table><tr><th>Property</th><th>Value</th></tr><tr><td>Paper</td><td>Custom</td></tr></table>
    <hr data-syntax="thematic_break">
    <p>Change the CSS on the left to update this preview.</p>
  </div>
</section>`;

const vscode = acquireVsCodeApi();
function element(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id}.`);
  return node;
}

const editor = element("editor");
const lightButton = element("theme-light");
const darkButton = element("theme-dark");
const profileButtons = document.querySelectorAll<HTMLButtonElement>(".profile-button");
const styleMenuToggle = element("style-menu-toggle");
const styleMenuPanel = element("style-menu-panel");
const customCssEditor = element("custom-css-editor") as HTMLTextAreaElement;
const customCssFile = element("custom-css-file") as HTMLInputElement;
const importCssButton = element("import-css");
const loadExampleButton = element("load-css-example");
const applyCssButton = element("apply-custom-css");
const cssStatus = element("custom-css-status");
const cssPreview = element("custom-css-preview") as HTMLIFrameElement;
const toolbarElement = document.querySelector<HTMLElement>(".toolbar");
if (!toolbarElement) throw new Error("Missing .toolbar.");
const toolbar: HTMLElement = toolbarElement;
const customStyles = document.createElement("style");
document.head.append(customStyles);
const savedState = vscode.getState();
let activeProfile: RenderProfile = isRenderProfile(savedState?.profile) ? savedState.profile : "basic";
let activeCustomCss = typeof savedState?.customCss === "string" ? savedState.customCss : "";
let cssDraft =
  typeof savedState?.cssDraft === "string"
    ? savedState.cssDraft
    : activeCustomCss || exampleCss;
let previewProfile = activeProfile;
let externalStylesheets: { name: string; text: string }[] = [];

customCssEditor.value = cssDraft;

function persistStyleState(): void {
  vscode.setState({
    profile: activeProfile,
    customCss: activeCustomCss,
    cssDraft,
  });
}

function renderCssPreview(css: string, profile = previewProfile): void {
  const theme = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  const safeCss = `${profileCss[profile]}\n${css}`.replaceAll("<", "\\3C ");
  cssPreview.srcdoc = `<!doctype html>
<html lang="en" data-profile="${profile}">
<head>
  <meta charset="UTF-8">
  <style>${previewBaseCss}\n${safeCss}</style>
</head>
<body data-theme="${theme}">
  ${previewMarkup.replace('data-theme="light"', `data-theme="${theme}"`)}
</body>
</html>`;
}

function applyStylesheets(): void {
  const configuredCss = externalStylesheets
    .map(
      (stylesheet) =>
        `/* ${stylesheet.name.replaceAll("*/", "* /")} */\n${stylesheet.text}`,
    )
    .join("\n");
  customStyles.textContent = [configuredCss, activeCustomCss].filter(Boolean).join("\n");
}

function updateCssDraft(status: string): void {
  cssDraft = customCssEditor.value;
  persistStyleState();
  renderCssPreview(cssDraft || exampleCss);
  cssStatus.textContent = status;
}

function setStyleMenuOpen(open: boolean): void {
  styleMenuPanel.hidden = !open;
  styleMenuToggle.setAttribute("aria-expanded", String(open));
}

let pendingSend: number | undefined;
let pendingEdit: EditMessage | undefined;
const outgoingTexts: string[] = [];
let collapseTimer: number | undefined;

function expandToolbar(): void {
  if (collapseTimer !== undefined) {
    window.clearTimeout(collapseTimer);
    collapseTimer = undefined;
  }
  toolbar.classList.remove("is-collapsed");
}

function collapseToolbarLater(): void {
  if (collapseTimer !== undefined) window.clearTimeout(collapseTimer);
  collapseTimer = window.setTimeout(() => {
    if (!toolbar.matches(":hover")) toolbar.classList.add("is-collapsed");
  }, 500);
}

toolbar.addEventListener("mouseenter", expandToolbar);
toolbar.addEventListener("mouseleave", collapseToolbarLater);
collapseToolbarLater();

styleMenuToggle.addEventListener("click", () => {
  const open = styleMenuPanel.hasAttribute("hidden");
  setStyleMenuOpen(open);
  if (open) expandToolbar();
});
document.addEventListener("pointerdown", (event) => {
  if (
    event.target instanceof Node &&
    !styleMenuPanel.contains(event.target) &&
    !styleMenuToggle.contains(event.target)
  ) {
    setStyleMenuOpen(false);
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !styleMenuPanel.hidden) {
    setStyleMenuOpen(false);
    styleMenuToggle.focus();
  }
});

function updateThemeButtons(): void {
  const isDark = document.documentElement.dataset.theme === "dark";
  lightButton.setAttribute("aria-pressed", String(!isDark));
  darkButton.setAttribute("aria-pressed", String(isDark));
  renderCssPreview(cssDraft || exampleCss);
}

lightButton.addEventListener("click", () => {
  setTheme("light");
  updateThemeButtons();
});
darkButton.addEventListener("click", () => {
  setTheme("dark");
  updateThemeButtons();
});
updateThemeButtons();

setRenderProfile(activeProfile);
function updateProfileButtons(profile: RenderProfile): void {
  for (const button of profileButtons) {
    button.setAttribute("aria-pressed", String(button.dataset.profile === profile));
  }
}
updateProfileButtons(activeProfile);

function showProfilePreview(profile: RenderProfile): void {
  previewProfile = profile;
  renderCssPreview(cssDraft || exampleCss, profile);
}

function restoreActiveProfilePreview(): void {
  window.requestAnimationFrame(() => {
    if (
      document.querySelector(
        ".profile-button:hover, .profile-button:focus-visible, .css-preview-container:hover, .css-preview-container:focus-within",
      )
    )
      return;
    showProfilePreview(activeProfile);
  });
}

for (const button of profileButtons) {
  const profile = button.dataset.profile;
  if (!isRenderProfile(profile)) {
    throw new Error(`Unknown render profile: ${profile}`);
  }
  button.addEventListener("pointerenter", () => showProfilePreview(profile));
  button.addEventListener("pointerleave", restoreActiveProfilePreview);
  button.addEventListener("focus", () => showProfilePreview(profile));
  button.addEventListener("blur", restoreActiveProfilePreview);
  button.addEventListener("click", () => {
    setRenderProfile(profile);
    activeProfile = profile;
    previewProfile = profile;
    persistStyleState();
    updateProfileButtons(profile);
    renderCssPreview(cssDraft || exampleCss, profile);
  });
}

applyStylesheets();
renderCssPreview(cssDraft || exampleCss);
customCssEditor.addEventListener("input", () => {
  updateCssDraft("Preview updated. Apply the CSS to change the paper.");
});
importCssButton.addEventListener("click", () => customCssFile.click());
customCssFile.addEventListener("change", () => {
  const file = customCssFile.files?.[0];
  if (!file) return;
  void file
    .text()
    .then((text) => {
      customCssEditor.value = text;
      updateCssDraft(`Loaded ${file.name} into the editor. Apply it to change the paper.`);
    })
    .catch((error: unknown) => {
      console.error("Could not import CSS file.", error);
      cssStatus.textContent = `Could not import CSS file: ${String(error)}`;
    })
    .finally(() => {
      customCssFile.value = "";
    });
});
loadExampleButton.addEventListener("click", () => {
  customCssEditor.value = exampleCss;
  updateCssDraft("Example loaded. Apply it to change the paper.");
});
applyCssButton.addEventListener("click", () => {
  activeCustomCss = cssDraft;
  applyStylesheets();
  persistStyleState();
  cssStatus.textContent = activeCustomCss
    ? "Custom CSS applied to the paper."
    : "Custom CSS cleared from the paper.";
});

try {
  const markdown = await createMarkdown();
  let health: "ready" | "failed" = "ready";
  let currentSource = "";
  let documentVersion = 0;

  function update(source = readEditorText(editor), selection = readSelection(editor)): void {
    patch(editor, markdown(source, selection?.focus));
    currentSource = source;
    editor.querySelector("[data-caret-placeholder]")?.remove();
    if (source.endsWith("\n")) {
      const placeholder = document.createElement("span");
      placeholder.dataset.caretPlaceholder = "";
      placeholder.setAttribute("aria-hidden", "true");
      placeholder.textContent = "\u200b";
      editor.append(placeholder);
    }
    if (selection) {
      selection = {
        anchor: Math.min(selection.anchor, source.length),
        focus: Math.min(selection.focus, source.length),
      };
      restoreSelection(editor, selection);
    }
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
        vscode.postMessage(pendingEdit);
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
    editor.contentEditable = "false";
    editor.setAttribute("aria-readonly", "true");
    console.error("Markdown editor failed.", error);
    const detail = error instanceof Error ? error.message : String(error);
    vscode.postMessage({ type: "error", message: detail });
    const notice = document.createElement("div");
    notice.className = "editor-error";
    notice.setAttribute("role", "alert");
    notice.textContent = `Viewlife could not render this Markdown file: ${detail}`;
    editor.replaceChildren(notice);
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

  update("");
  editor.contentEditable = "true";
  editor.setAttribute("aria-readonly", "false");

  window.addEventListener("message", (event: MessageEvent<HostMessage>) => {
    const message = event.data;
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
      return;
    }
    externalStylesheets = message.stylesheets;
    applyStylesheets();
  });
  vscode.postMessage({ type: "ready" });

  editor.addEventListener("input", (event: InputEvent) => {
    if (event.isComposing || health !== "ready") return;
    try {
      localChange();
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
      insertText("\n");
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
  editor.addEventListener("drop", (event) => event.preventDefault());
  editor.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") {
      event.preventDefault();
      window.getSelection()?.setBaseAndExtent(editor, 0, editor, editor.childNodes.length);
    }
  });
  function syncActiveLine(): void {
    const selection = readSelection(editor);
    const activeLine =
      document.activeElement === editor && selection
        ? currentSource.lastIndexOf("\n", selection.focus - 1) + 1
        : -1;
    const focus = activeLine === -1 ? undefined : selection?.focus;
    patch(editor, markdown(currentSource, focus));
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
    const position =
      bounds.width === 0
        ? 0
        : Math.round(
            (Math.max(0, Math.min(event.clientX - bounds.left, bounds.width)) / bounds.width) *
              text.length,
          );
    window.getSelection()?.setBaseAndExtent(text, position, text, position);
    syncActiveLine();
  });
  document.addEventListener("selectionchange", syncActiveLine);
  editor.addEventListener("blur", syncActiveLine);
  editor.addEventListener("keydown", (event) => {
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
} catch (error) {
  editor.contentEditable = "false";
  editor.setAttribute("aria-readonly", "true");
  console.error("Could not start the Markdown editor.", error);
  const detail = error instanceof Error ? error.message : String(error);
  vscode.postMessage({ type: "error", message: detail });
  const notice = document.createElement("div");
  notice.className = "editor-error";
  notice.setAttribute("role", "alert");
  notice.textContent = `Viewlife could not render this Markdown file: ${detail}`;
  editor.replaceChildren(notice);
}
