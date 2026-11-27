// The "Styles" panel: render profile choice, profile preview and the custom CSS workbench.
import type { Stylesheet } from "../host/host";
import type { Preferences } from "../host/preferences";
import { isRenderProfile, setRenderProfile, type RenderProfile } from "../paper/profiles";
import { basicCss, profileCss } from "../paper/presets";
import { byId, query } from "./dom";

// ----- mini preview of a profile (sandboxed iframe) -----

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
html, body { scrollbar-width: none; }
html::-webkit-scrollbar, body::-webkit-scrollbar { display: none; }
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

function renderCssPreview(frame: HTMLIFrameElement, css: string, profile: RenderProfile): void {
  const theme = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  const safeCss = `${profileCss[profile]}\n${css}`.replaceAll("<", "\\3C ");
  frame.srcdoc = `<!doctype html>
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

// ----- styles panel -----

export type StylePreferences = Omit<Preferences, "theme">;

export type StyleMenu = {
  preferences(): StylePreferences;
  /** Applies preferences changed in another tab. */
  apply(preferences: Preferences): void;
  /** Re-renders the preview, e.g. after a theme change. */
  refreshPreview(): void;
  setExternalStylesheets(stylesheets: Stylesheet[]): void;
};

export function setupStyleMenu(
  initial: Preferences,
  hooks: { onChange(): void; onOpen(): void },
): StyleMenu {
  const profileButtons = document.querySelectorAll<HTMLButtonElement>(".profile-button");
  const profileActions = query<HTMLElement>(".profile-actions");
  const previewContainer = query<HTMLElement>(".css-preview-container");
  const toggle = byId("style-menu-toggle");
  const panel = byId("style-menu-panel");
  const cssEditor = byId<HTMLTextAreaElement>("custom-css-editor");
  const cssFile = byId<HTMLInputElement>("custom-css-file");
  const importButton = byId("import-css");
  const loadExampleButton = byId("load-css-example");
  const applyButton = byId("apply-custom-css");
  const status = byId("custom-css-status");
  const previewFrame = byId<HTMLIFrameElement>("custom-css-preview");

  let activeProfile: RenderProfile = isRenderProfile(initial.profile) ? initial.profile : "basic";
  let customCssActive = initial.customCssActive === true && typeof initial.appliedCss === "string";
  let activePaperCss = customCssActive && typeof initial.appliedCss === "string" ? initial.appliedCss : basicCss;
  let cssDraft = typeof initial.cssDraft === "string" ? initial.cssDraft : activePaperCss;
  let previewProfile = activeProfile;
  let externalStylesheets: Stylesheet[] = [];
  let previewOpenTimer: number | undefined;
  let previewCloseTimer: number | undefined;

  const paperStyles = document.createElement("style");
  const customStyles = document.createElement("style");
  document.head.append(paperStyles, customStyles);

  function preferences(): StylePreferences {
    // The built-in CSS is part of the bundle; only store CSS the user actually wrote.
    return {
      profile: activeProfile,
      customCssActive,
      appliedCss: customCssActive ? activePaperCss : undefined,
      cssDraft: cssDraft !== basicCss ? cssDraft : undefined,
    };
  }

  function refreshPreview(): void {
    renderCssPreview(previewFrame, cssDraft, previewProfile);
  }

  function applyStylesheets(): void {
    paperStyles.textContent = activePaperCss;
    customStyles.textContent = externalStylesheets
      .map((stylesheet) => `/* ${stylesheet.name.replaceAll("*/", "* /")} */\n${stylesheet.text}`)
      .join("\n");
  }

  function updateApplyButton(): void {
    const hasUnappliedChanges = customCssActive && cssEditor.value !== activePaperCss;
    applyButton.textContent = customCssActive
      ? hasUnappliedChanges
        ? "Apply changes"
        : "Restore preset"
      : "Apply to paper";
    applyButton.setAttribute("aria-pressed", String(customCssActive));
  }

  function updateProfileButtons(): void {
    for (const button of profileButtons) {
      button.setAttribute("aria-pressed", String(!customCssActive && button.dataset.profile === activeProfile));
    }
    updateApplyButton();
  }

  function updateDraft(message: string): void {
    cssDraft = cssEditor.value;
    hooks.onChange();
    refreshPreview();
    updateApplyButton();
    status.textContent = message;
  }

  function setOpen(open: boolean): void {
    if (!open) {
      window.clearTimeout(previewOpenTimer);
      window.clearTimeout(previewCloseTimer);
      previewOpenTimer = undefined;
      previewCloseTimer = undefined;
      panel.classList.remove("is-preview-open");
    }
    panel.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    if (open) hooks.onOpen();
  }

  // ----- profile hover preview -----

  function positionPreview(button: HTMLButtonElement): void {
    const panelRect = panel.getBoundingClientRect();
    const actionsRect = profileActions.getBoundingClientRect();
    const previewWidth = Number.parseFloat(getComputedStyle(previewContainer).width);
    const buttonLeft = button.getBoundingClientRect().left - panelRect.left - panel.clientLeft + panel.scrollLeft;
    const maxLeft = panel.clientWidth - previewWidth - 12;
    previewContainer.style.left = `${Math.max(12, Math.min(buttonLeft, maxLeft))}px`;
    previewContainer.style.top = `${actionsRect.bottom - panelRect.top - panel.clientTop + panel.scrollTop + 8}px`;
  }

  function showPreview(profile: RenderProfile): void {
    previewProfile = profile;
    refreshPreview();
  }

  function openPreview(button: HTMLButtonElement, profile: RenderProfile): void {
    window.clearTimeout(previewCloseTimer);
    previewCloseTimer = undefined;
    positionPreview(button);
    if (panel.classList.contains("is-preview-open")) {
      showPreview(profile);
      return;
    }
    window.clearTimeout(previewOpenTimer);
    previewOpenTimer = window.setTimeout(() => {
      previewOpenTimer = undefined;
      panel.classList.add("is-preview-open");
      window.requestAnimationFrame(() => {
        if (!panel.hidden && panel.classList.contains("is-preview-open")) showPreview(profile);
      });
    }, 100);
  }

  function closePreviewLater(): void {
    window.clearTimeout(previewCloseTimer);
    previewCloseTimer = window.setTimeout(() => {
      previewCloseTimer = undefined;
      if (
        document.querySelector(
          ".profile-button:hover, .profile-button:focus-visible, .css-preview-container:hover, .css-preview-container:focus-within",
        )
      )
        return;
      panel.classList.remove("is-preview-open");
      showPreview(activeProfile);
    }, 250);
  }

  function keepPreviewOpen(): void {
    window.clearTimeout(previewCloseTimer);
    previewCloseTimer = undefined;
  }

  // ----- wiring -----

  toggle.addEventListener("click", () => setOpen(panel.hasAttribute("hidden")));
  document.addEventListener("pointerdown", (event) => {
    if (event.target instanceof Node && !panel.contains(event.target) && !toggle.contains(event.target)) {
      setOpen(false);
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !panel.hidden) {
      setOpen(false);
      toggle.focus();
    }
  });

  for (const button of profileButtons) {
    const profile = button.dataset.profile;
    if (!isRenderProfile(profile)) throw new Error(`Unknown render profile: ${profile}`);
    button.addEventListener("pointerenter", () => openPreview(button, profile));
    button.addEventListener("pointerleave", closePreviewLater);
    button.addEventListener("focus", () => openPreview(button, profile));
    button.addEventListener("blur", closePreviewLater);
    button.addEventListener("click", () => {
      setRenderProfile(profile);
      activeProfile = profile;
      previewProfile = profile;
      customCssActive = false;
      activePaperCss = basicCss;
      applyStylesheets();
      hooks.onChange();
      updateProfileButtons();
      refreshPreview();
      status.textContent = "Built-in profile selected. Custom CSS is inactive.";
    });
  }

  previewContainer.addEventListener("pointerenter", keepPreviewOpen);
  previewContainer.addEventListener("pointerleave", closePreviewLater);
  previewContainer.addEventListener("focusin", keepPreviewOpen);
  previewContainer.addEventListener("focusout", closePreviewLater);

  cssEditor.addEventListener("input", () => updateDraft("Preview updated. Apply the CSS to change the paper."));
  importButton.addEventListener("click", () => cssFile.click());
  cssFile.addEventListener("change", () => {
    const file = cssFile.files?.[0];
    if (!file) return;
    void file
      .text()
      .then((text) => {
        cssEditor.value = text;
        updateDraft(`Loaded ${file.name} into the editor. Apply it to change the paper.`);
      })
      .catch((error: unknown) => {
        console.error("Could not import CSS file.", error);
        status.textContent = `Could not import CSS file: ${String(error)}`;
      })
      .finally(() => {
        cssFile.value = "";
      });
  });
  loadExampleButton.addEventListener("click", () => {
    cssEditor.value = basicCss;
    updateDraft("Basic CSS loaded. Apply it to the paper or edit it first.");
  });
  applyButton.addEventListener("click", () => {
    cssDraft = cssEditor.value;
    if (customCssActive && cssDraft === activePaperCss) {
      customCssActive = false;
      activePaperCss = basicCss;
      status.textContent = "Built-in CSS preset restored.";
    } else {
      customCssActive = true;
      activePaperCss = cssDraft;
      status.textContent = activePaperCss.trim()
        ? "Custom CSS applied temporarily."
        : "Empty custom CSS applied temporarily.";
    }
    applyStylesheets();
    hooks.onChange();
    refreshPreview();
    updateProfileButtons();
  });

  // ----- initial state -----

  setRenderProfile(activeProfile);
  cssEditor.value = cssDraft;
  applyStylesheets();
  updateProfileButtons();
  refreshPreview();

  return {
    preferences,
    refreshPreview,
    setExternalStylesheets(stylesheets) {
      externalStylesheets = stylesheets;
      applyStylesheets();
    },
    apply(next) {
      if (isRenderProfile(next.profile)) {
        activeProfile = next.profile;
        previewProfile = next.profile;
        setRenderProfile(next.profile);
      }
      customCssActive = next.customCssActive === true && typeof next.appliedCss === "string";
      activePaperCss = customCssActive && typeof next.appliedCss === "string" ? next.appliedCss : basicCss;
      // Don't overwrite CSS the user is typing in this tab right now.
      if (document.activeElement !== cssEditor) {
        cssDraft = typeof next.cssDraft === "string" ? next.cssDraft : basicCss;
        cssEditor.value = cssDraft;
      }
      applyStylesheets();
      updateProfileButtons();
      refreshPreview();
    },
  };
}
