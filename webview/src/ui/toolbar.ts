// Top bar: auto-hiding header with the theme switch, PDF export and the styles menu toggle.
import { getTheme, isThemeMode, onThemeChange, setTheme, type ThemeMode } from "../paper/theme";
import { query } from "./dom";

export type Toolbar = { expand(): void };

export function setupToolbar(hooks: { onThemeSelected(mode: ThemeMode): void }): Toolbar {
  const toolbar = query<HTMLElement>(".toolbar");
  const themeOptions = toolbar.querySelectorAll<HTMLButtonElement>(".theme-option");
  let collapseTimer: number | undefined;

  function expand(): void {
    window.clearTimeout(collapseTimer);
    collapseTimer = undefined;
    toolbar.classList.remove("is-collapsed");
  }

  function collapseLater(): void {
    window.clearTimeout(collapseTimer);
    collapseTimer = window.setTimeout(() => {
      if (!toolbar.matches(":hover, :focus-within")) toolbar.classList.add("is-collapsed");
    }, 500);
  }

  toolbar.addEventListener("mouseenter", expand);
  toolbar.addEventListener("mouseleave", collapseLater);
  toolbar.addEventListener("focusout", collapseLater);
  collapseLater();

  function updateThemeOptions(): void {
    const mode = getTheme();
    for (const option of themeOptions) {
      option.setAttribute("aria-pressed", String(option.dataset.themeMode === mode));
    }
  }

  for (const option of themeOptions) {
    option.addEventListener("click", () => {
      const mode = option.dataset.themeMode;
      if (!isThemeMode(mode)) return;
      setTheme(mode);
      hooks.onThemeSelected(mode);
    });
  }
  onThemeChange(updateThemeOptions);
  updateThemeOptions();

  return { expand };
}
