import * as assert from "assert";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { normalizeLineEndings } from "../extension";

suite("Viewlife Extension Test Suite", () => {
  test("normalizes document line endings for webview synchronization", () => {
    assert.strictEqual(normalizeLineEndings("first\r\nsecond\rthird\n"), "first\nsecond\nthird\n");
  });

  test("registers the Markdown custom editor as the default", async () => {
    const extension = vscode.extensions.all.find(
      (candidate) => candidate.packageJSON.name === "viewlife",
    );

    assert.ok(extension);
    await extension.activate();
    assert.ok(extension.isActive);
    const customEditors = extension.packageJSON.contributes.customEditors;
    assert.strictEqual(customEditors[0].viewType, "viewlife.markdown");
    assert.strictEqual(customEditors[0].priority, "default");
    assert.ok(
      customEditors[0].selector.some(
        (selector: { filenamePattern: string }) => selector.filenamePattern === "*.md",
      ),
    );
  });

  test("opens a Markdown document in the Viewlife custom editor", async () => {
    const file = vscode.Uri.file(path.join(os.tmpdir(), `viewlife-${Date.now()}.md`));
    await vscode.workspace.fs.writeFile(file, Buffer.from("# Viewlife test\n"));
    try {
      await vscode.commands.executeCommand("vscode.openWith", file, "viewlife.markdown");
      const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
      assert.ok(tab);
      assert.strictEqual(tab.input instanceof vscode.TabInputCustom, true);
      assert.strictEqual((tab.input as vscode.TabInputCustom).viewType, "viewlife.markdown");
      await new Promise((resolve) => setTimeout(resolve, 500));
    } finally {
      await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
      await vscode.workspace.fs.delete(file, { useTrash: false });
    }
  });
});
