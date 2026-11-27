// Messaging with the extension host (src/extension.ts). The VS Code API may only be acquired once.
import type { Preferences } from "./preferences";

export type Stylesheet = { name: string; text: string };

export type HostMessage =
  | { type: "document"; text: string; baseUri: string; version: number }
  | { type: "stylesheets"; stylesheets: Stylesheet[] }
  | { type: "preferences"; preferences: Preferences }
  | { type: "markdown-file"; id: number; text?: string; baseUri?: string; error?: string };

export type EditMessage = { type: "edit"; previousText: string; text: string };

export type ExtensionMessage =
  | EditMessage
  | { type: "ready" }
  | { type: "error"; message: string }
  | { type: "export"; pdf: string }
  | { type: "export-error"; message: string }
  | { type: "preferences"; preferences: Preferences }
  | { type: "open-link"; href: string }
  | { type: "read-markdown"; id: number; href: string };

declare function acquireVsCodeApi(): {
  postMessage(message: ExtensionMessage): void;
  getState(): Preferences | undefined;
  setState(state: Preferences): void;
};

const api = acquireVsCodeApi();

export function postToHost(message: ExtensionMessage): void {
  api.postMessage(message);
}

/** Per-panel state; survives reloads of this panel only. Global state lives in the extension. */
export function getPanelState(): Preferences | undefined {
  return api.getState();
}

export function setPanelState(state: Preferences): void {
  api.setState(state);
}

export function onHostMessage(listener: (message: HostMessage) => void): void {
  window.addEventListener("message", (event: MessageEvent<HostMessage>) => {
    if (typeof event.data === "object" && event.data !== null) listener(event.data);
  });
}

/** Reports a fatal editor error to the host and replaces the editor with a notice. */
export function showFatalError(editor: HTMLElement, error: unknown, context: string): void {
  editor.contentEditable = "false";
  editor.setAttribute("aria-readonly", "true");
  console.error(context, error);
  const detail = error instanceof Error ? error.message : String(error);
  postToHost({ type: "error", message: detail });
  const notice = document.createElement("div");
  notice.className = "editor-error";
  notice.setAttribute("role", "alert");
  notice.textContent = `ViewLive could not render this Markdown file: ${detail}`;
  editor.replaceChildren(notice);
}
