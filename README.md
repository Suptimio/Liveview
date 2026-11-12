# Viewlife

Viewlife opens `.md` and `.markdown` files directly as a live WYSIWYG editor in VS Code. Markdown edits are written back to the file, so normal VS Code saving, undo, and file-change handling continue to work.

## Features

- Direct Markdown editor with live rendering and inline Markdown editing
- A Basic style and selectable local GitHub, GitLab, and VS Code style profiles, plus light and dark themes
- A style menu with an editable CSS example, CSS file import, and live mini-paper preview
- Separate UI styling in `webview/src/ui.css`, independent of the paper styles in `webview/src/style.css`
- Additional CSS files, reloaded while editing or saving CSS in VS Code
- Images, tables, lists, and common Markdown syntax rendered in the document

## Custom stylesheets

Add stylesheet paths to the VS Code setting `viewlife.customStylesheets`. Paths may be absolute or relative to the workspace folder:

```json
{
  "viewlife.customStylesheets": [
    ".viewlife/document.css",
    "C:/styles/print.css"
  ]
}
```

The Basic style in `webview/src/style.css` is the shared foundation. Profiles only add CSS overrides and can be selected in the editor; custom stylesheets are applied after the selected profile, without modifying the foundation. The built-in profile styles are local and do not fetch styles from those websites. Saving a CSS file or changing it in VS Code refreshes the rendered document.

Use the Styles menu to edit the example CSS or import a `.css` file. Hover a CSS profile to see its larger mini-paper preview. Custom CSS is previewed there too and only affects the document after selecting **Apply to paper**. The applied CSS is stored with the editor state.

The shared layout can be customized through CSS variables. For example:

```css
:root {
  --content-width: 900px;
  --content-font-size: 17px;
  --content-line-height: 1.7;
  --paper-padding: 32px;
  --paper-border: 1px solid #888;
  --paper-border-radius: 12px;
  --paper-shadow: none;
}
```

## Development

Run `pnpm install`, then `pnpm run compile`. To launch the extension, open this folder in VS Code and press `F5`.

## Acknowledgements

The Markdown renderer/editor is adapted from `md-dom` by Frank Mayer. See [LICENSE](./LICENSE) for its Zlib license and [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) for bundled Tree-sitter licenses.
