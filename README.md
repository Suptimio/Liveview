# Viewlife

Viewlife opens `.md` and `.markdown` files directly as a live WYSIWYG editor in VS Code. Markdown edits are written back to the file, so normal VS Code saving, undo, and file-change handling continue to work.

## Features

- Direct Markdown editor with live rendering and inline Markdown editing
- GitHub, GitLab, and VS Code style profiles, plus light and dark themes
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

Custom stylesheets are applied after the selected built-in profile. Saving a CSS file or changing it in VS Code refreshes the rendered document.

## Development

Run `pnpm install`, then `pnpm run compile`. To launch the extension, open this folder in VS Code and press `F5`.

## Acknowledgements

The Markdown renderer/editor is adapted from `md-dom` by Frank Mayer. See [LICENSE](./LICENSE) for its Zlib license and [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) for bundled Tree-sitter licenses.
