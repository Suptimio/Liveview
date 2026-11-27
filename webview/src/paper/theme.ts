import theme from "./theme.json";

export type ThemeMode = "system" | "light" | "dark";
export type ThemeAppearance = "light" | "dark";

const appearance = window.matchMedia("(prefers-color-scheme: dark)");
const listeners = new Set<(mode: ThemeAppearance) => void>();

let selectedMode: ThemeMode = "system";

export function isThemeMode(mode: unknown): mode is ThemeMode {
  return mode === "system" || mode === "light" || mode === "dark";
}

/** VS Code marks the webview body with the host theme kind; fall back to the OS setting. */
function systemAppearance(): ThemeAppearance {
  const classes = document.body?.classList;
  if (classes?.contains("vscode-high-contrast-light") || classes?.contains("vscode-light")) return "light";
  if (classes?.contains("vscode-dark") || classes?.contains("vscode-high-contrast")) return "dark";
  return appearance.matches ? "dark" : "light";
}

function updateTheme() {
  const mode: ThemeAppearance = selectedMode === "system" ? systemAppearance() : selectedMode;

  document.documentElement.style.colorScheme = mode;

  for (const [name, color] of Object.entries(theme[mode])) {
    document.documentElement.style.setProperty(`--${name}`, color);
  }

  document.documentElement.dataset.theme = mode;

  // Profile stylesheets scope their colors to `.paper[data-theme]`, so the
  // paper has to follow the selected mode as well.
  for (const paper of document.querySelectorAll<HTMLElement>(".paper")) {
    paper.dataset.theme = mode;
  }

  for (const listener of listeners) listener(mode);
}

export function setTheme(mode: ThemeMode) {
  selectedMode = mode;
  updateTheme();
}

export function getTheme(): ThemeMode {
  return selectedMode;
}

/** Called after every appearance update, including host theme switches. */
export function onThemeChange(listener: (mode: ThemeAppearance) => void): void {
  listeners.add(listener);
}

appearance.addEventListener("change", () => {
  if (selectedMode === "system") updateTheme();
});

// The host theme can change while the webview is open (body class switch).
// Color-only switches (same kind) also matter for the live VS Code profile colors.
if (document.body) {
  new MutationObserver(() => updateTheme()).observe(document.body, {
    attributes: true,
    attributeFilter: ["class"],
  });
}

updateTheme();
