// Entry point: wires the modules together.
//   editor/   Markdown editing core (parser, rendering, selection, table/image previews)
//   actions/  editor actions offered in the tool bubble (table, list sorting)
//   paper/    how the document looks: base + syntax CSS, render profiles, light/dark theme
//   ui/       everything around the paper: top bar, tool bubble, styles panel (ui.css)
//   host/     talking to the extension: messages, saved preferences, PDF export
//   icons/    every UI icon as its own .svg file
import { listActions } from "./actions/list";
import { insertTableAction } from "./actions/table";
import { createEditor } from "./editor/editor";
import { setupInlineHtmlPen } from "./editor/html-pen";
import { setupLineHint } from "./editor/line-hint";
import { setupLinks } from "./editor/links";
import { setupExporter } from "./host/exporter";
import { byId } from "./ui/dom";
import { onHostMessage, postToHost, showFatalError } from "./host/host";
import { createMarkdown } from "./editor/markdown";
import { renderIcons } from "./icons";
import { onPreferencesChanged, readSavedPreferences, savePreferences } from "./host/preferences";
import { setupStyleMenu } from "./ui/style-menu";
import { getTheme, isThemeMode, onThemeChange, setTheme } from "./paper/theme";
import { setupToolbar } from "./ui/toolbar";
import { setupToolMenu } from "./ui/tool-menu";
import "./ui/ui.css";

renderIcons();
const saved = readSavedPreferences();

const savePreferencesNow = () => savePreferences({ theme: getTheme(), ...styleMenu.preferences() });

const toolbar = setupToolbar({ onThemeSelected: savePreferencesNow });
const styleMenu = setupStyleMenu(saved, { onChange: savePreferencesNow, onOpen: toolbar.expand });

onThemeChange(() => styleMenu.refreshPreview());
// Without a saved choice the paper follows the VS Code theme.
setTheme(isThemeMode(saved.theme) ? saved.theme : "system");

// Theme and profile are global: another tab changed them -> follow.
onPreferencesChanged((preferences) => {
  if (isThemeMode(preferences.theme)) setTheme(preferences.theme);
  styleMenu.apply(preferences);
});

onHostMessage((message) => {
  if (message.type === "stylesheets") styleMenu.setExternalStylesheets(message.stylesheets);
});

setupExporter(
  byId<HTMLButtonElement>("export-pdf"),
  byId("paper"),
  (pdf) => postToHost({ type: "export", pdf }),
  (message) => postToHost({ type: "export-error", message }),
);

const editorElement = byId("editor");
try {
  const editor = createEditor(editorElement, await createMarkdown());
  setupToolMenu(editor, [insertTableAction, ...listActions]);
  setupLinks(editorElement);
  setupLineHint(editorElement, byId("paper"));
  setupInlineHtmlPen(editorElement, byId("paper"));
} catch (error) {
  showFatalError(editorElement, error, "Could not start the Markdown editor.");
}
