import theme from "./theme.json";

export type ThemeMode = "system" | "light" | "dark";
export type ThemeAppearance = "light" | "dark";

const appearance = window.matchMedia("(prefers-color-scheme: dark)");

let selectedMode: ThemeMode = "system";

function updateTheme() {
  const mode: ThemeAppearance =
    selectedMode === "system"
      ? appearance.matches
        ? "dark"
        : "light"
      : selectedMode;

  document.documentElement.style.colorScheme = mode;

  for (const [name, color] of Object.entries(theme[mode])) {
    document.documentElement.style.setProperty(`--${name}`, color);
  }

  document.documentElement.dataset.theme = mode;
}

export function setTheme(mode: ThemeMode) {
  selectedMode = mode;
  updateTheme();
}

export function getTheme(): ThemeMode {
  return selectedMode;
}

appearance.addEventListener("change", () => {
  if (selectedMode === "system") updateTheme();
});

updateTheme();
