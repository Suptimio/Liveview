import { createMarkdown } from "./markdown";
import { readEditorText, readSelection, restoreSelection, revealSyntax } from "./selection";
import { patch } from "./vdom";
import { setRenderProfile, type RenderProfile } from "./profiles";
import { setTheme } from "./theme";
import "./style.css";

type HostMessage =
  | { type: "document"; text: string; baseUri: string; version: number }
  | { type: "stylesheets"; stylesheets: { name: string; text: string }[] };

type EditMessage = { type: "edit"; previousText: string; text: string };
type ExtensionMessage = EditMessage | { type: "ready" } | { type: "error"; message: string };

declare function acquireVsCodeApi(): {
  postMessage(message: ExtensionMessage): void;
  getState(): { profile?: RenderProfile } | undefined;
  setState(state: { profile: RenderProfile }): void;
};

const vscode = acquireVsCodeApi();
function element(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id}.`);
  return node;
}

const editor = element("editor");
const lightButton = element("theme-light");
const darkButton = element("theme-dark");
const toolbarElement = document.querySelector<HTMLElement>(".toolbar");
if (!toolbarElement) throw new Error("Missing .toolbar.");
const toolbar: HTMLElement = toolbarElement;
const profileSelect = element("profile-select") as HTMLSelectElement;
const customStyles = document.createElement("style");
document.head.append(customStyles);

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

function updateThemeButtons(): void {
  const isDark = document.documentElement.dataset.theme === "dark";
  lightButton.setAttribute("aria-pressed", String(!isDark));
  darkButton.setAttribute("aria-pressed", String(isDark));
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

const savedProfile = vscode.getState()?.profile;
const initialProfile =
  savedProfile && ["github", "gitlab", "vscode"].includes(savedProfile) ? savedProfile : "github";
profileSelect.value = initialProfile;
setRenderProfile(initialProfile);
profileSelect.addEventListener("change", () => {
  const profile = profileSelect.value as RenderProfile;
  setRenderProfile(profile);
  vscode.setState({ profile });
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
    customStyles.textContent = message.stylesheets
      .map((stylesheet) => `/* ${stylesheet.name.replaceAll("*/", "* /")} */\n${stylesheet.text}`)
      .join("\n");
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
