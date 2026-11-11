import * as path from "node:path";
import { readFile } from "node:fs/promises";
import * as vscode from "vscode";

type WebviewMessage =
  | { type: "ready" }
  | { type: "error"; message: string }
  | { type: "edit"; previousText: string; text: string };

type Stylesheet = { name: string; text: string };

type EditorState = {
  panel: vscode.WebviewPanel;
  document: vscode.TextDocument;
  documentBaseUri: string;
  ready: boolean;
  editQueue: Promise<void>;
};

class MarkdownEditorProvider implements vscode.CustomTextEditorProvider {
  private readonly editors = new Set<EditorState>();
  private readonly reportedStylesheetErrors = new Set<string>();

  constructor(private readonly context: vscode.ExtensionContext) {}

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    panel: vscode.WebviewPanel,
  ): Promise<void> {
    const documentDirectory = vscode.Uri.joinPath(document.uri, "..");
    const resourceRoot =
      vscode.workspace.getWorkspaceFolder(document.uri)?.uri ??
      documentDirectory;
    const documentBaseUri = `${panel.webview.asWebviewUri(documentDirectory).toString()}/`;
    const state: EditorState = {
      panel,
      document,
      documentBaseUri,
      ready: false,
      editQueue: Promise.resolve(),
    };
    this.editors.add(state);
    panel.onDidDispose(() => this.editors.delete(state), null, this.context.subscriptions);

    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview"),
        resourceRoot,
      ],
    };
    panel.webview.html = await this.getHtml(panel.webview);

    panel.webview.onDidReceiveMessage(
      (message: WebviewMessage) => {
        if (message.type === "ready") {
          state.ready = true;
          void this.sendDocument(state);
          void this.sendStylesheets(state);
          return;
        }
        if (message.type === "error") {
          const detail = `Viewlife could not start for ${path.basename(document.fileName)}: ${message.message}`;
          console.error(detail);
          void vscode.window.showErrorMessage(detail);
          return;
        }
        if (
          message.type !== "edit" ||
          typeof message.text !== "string" ||
          typeof message.previousText !== "string"
        ) {
          return;
        }
        state.editQueue = state.editQueue
          .then(() => this.applyEdit(state, message))
          .catch(async (error: unknown) => {
            const message = `Viewlife could not save ${path.basename(state.document.fileName)}: ${String(error)}`;
            console.error(message);
            vscode.window.showErrorMessage(message);
            await this.sendDocument(state);
          });
      },
      null,
      this.context.subscriptions,
    );

    const documentChanges = vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.uri.toString() === document.uri.toString()) {
        void this.sendDocument(state);
      }
    });
    panel.onDidDispose(() => documentChanges.dispose(), null, this.context.subscriptions);
  }

  async refreshStylesheets(): Promise<void> {
    await Promise.all([...this.editors].map((state) => this.sendStylesheets(state)));
  }

  private async applyEdit(
    state: EditorState,
    message: Extract<WebviewMessage, { type: "edit" }>,
  ): Promise<void> {
    if (state.document.isClosed) {
      return;
    }
    if (state.document.getText() !== message.previousText) {
      await this.sendDocument(state);
      return;
    }

    const edit = new vscode.WorkspaceEdit();
    edit.replace(
      state.document.uri,
      new vscode.Range(state.document.positionAt(0), state.document.positionAt(state.document.getText().length)),
      message.text,
    );
    const applied = await vscode.workspace.applyEdit(edit);
    if (!applied) {
      vscode.window.showErrorMessage(`Viewlife could not update ${path.basename(state.document.fileName)}.`);
      await this.sendDocument(state);
    }
  }

  private async sendDocument(state: EditorState): Promise<void> {
    if (!state.ready || state.document.isClosed) {
      return;
    }
    await state.panel.webview.postMessage({
      type: "document",
      text: state.document.getText(),
      baseUri: state.documentBaseUri,
      version: state.document.version,
    });
  }

  private async sendStylesheets(state: EditorState): Promise<void> {
    if (!state.ready || state.document.isClosed) {
      return;
    }
    const entries = vscode.workspace
      .getConfiguration("viewlife", state.document.uri)
      .get<string[]>("customStylesheets", []);
    const folder = vscode.workspace.getWorkspaceFolder(state.document.uri);
    const stylesheets: Stylesheet[] = [];

    for (const entry of entries) {
      if (typeof entry !== "string" || !entry.trim()) {
        continue;
      }
      const filePath = path.isAbsolute(entry)
        ? entry
        : folder
          ? path.resolve(folder.uri.fsPath, entry)
          : undefined;
      if (!filePath) {
        this.reportStylesheetError(entry, "relative paths require an open workspace");
        continue;
      }

      try {
        const content = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
        stylesheets.push({ name: path.basename(filePath), text: new TextDecoder().decode(content) });
        this.reportedStylesheetErrors.delete(entry);
      } catch (error) {
        this.reportStylesheetError(entry, String(error));
      }
    }

    await state.panel.webview.postMessage({ type: "stylesheets", stylesheets });
  }

  private reportStylesheetError(entry: string, reason: string): void {
    if (this.reportedStylesheetErrors.has(entry)) {
      return;
    }
    this.reportedStylesheetErrors.add(entry);
    const message = `Viewlife could not load stylesheet "${entry}": ${reason}`;
    console.error(message);
    void vscode.window.showWarningMessage(message);
  }

  private async getHtml(webview: vscode.Webview): Promise<string> {
    const root = vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview");
    const html = await readFile(this.context.asAbsolutePath("dist/webview/index.html"), "utf8");
    const nonce = getNonce();
    const baseUri = `${webview.asWebviewUri(root).toString()}/`;
    const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri ${webview.cspSource}; connect-src ${webview.cspSource}; img-src ${webview.cspSource} https: http: data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'nonce-${nonce}' 'unsafe-eval' 'wasm-unsafe-eval';">`;
    return html
      .replace("<head>", `<head>\n<base href="${baseUri}">\n${csp}`)
      .replace(/<script\b(?![^>]*\bnonce=)([^>]*)>/g, `<script nonce="${nonce}"$1>`);
  }
}

function getNonce(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let nonce = "";
  for (let index = 0; index < 32; index++) {
    nonce += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return nonce;
}

export function activate(context: vscode.ExtensionContext): void {
  const provider = new MarkdownEditorProvider(context);
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider("viewlife.markdown", provider, {
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: true,
    }),
  );

  const refresh = () => void provider.refreshStylesheets();
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("viewlife.customStylesheets")) {
        refresh();
      }
    }),
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.languageId === "css") {
        refresh();
      }
    }),
    vscode.workspace.onDidSaveTextDocument((document) => {
      if (document.languageId === "css") {
        refresh();
      }
    }),
  );
  const stylesheetWatcher = vscode.workspace.createFileSystemWatcher("**/*.css");
  context.subscriptions.push(
    stylesheetWatcher,
    stylesheetWatcher.onDidChange(refresh),
    stylesheetWatcher.onDidCreate(refresh),
    stylesheetWatcher.onDidDelete(refresh),
  );
}

export function deactivate(): void {}
