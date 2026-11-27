// Global style preferences (theme, profile, custom CSS), shared by every Viewlife tab.
// The extension stores them in globalState, injects them into the page and relays changes.
import { getPanelState, onHostMessage, postToHost, setPanelState } from "./host";
import type { RenderProfile } from "../paper/profiles";
import type { ThemeMode } from "../paper/theme";

/** Mirrors `Preferences` in src/extension.ts. */
export type Preferences = {
  theme?: ThemeMode;
  profile?: RenderProfile;
  customCssActive?: boolean;
  appliedCss?: string;
  cssDraft?: string;
};

/** The global preferences injected by the extension win over this panel's own state. */
export function readSavedPreferences(): Preferences {
  const local = getPanelState() ?? {};
  const script = document.getElementById("viewlife-preferences");
  if (!script?.textContent) return local;
  try {
    const global: unknown = JSON.parse(script.textContent);
    return typeof global === "object" && global !== null && Object.keys(global).length
      ? (global as Preferences)
      : local;
  } catch (error) {
    console.error("Could not read saved Viewlife preferences.", error);
    return local;
  }
}

let pendingSave: number | undefined;

export function savePreferences(preferences: Preferences): void {
  setPanelState(preferences);
  // Debounced: the CSS editor saves on every keystroke.
  window.clearTimeout(pendingSave);
  pendingSave = window.setTimeout(() => {
    pendingSave = undefined;
    postToHost({ type: "preferences", preferences });
  }, 300);
}

/** Fires when another tab changed the preferences (relayed by the extension). */
export function onPreferencesChanged(listener: (preferences: Preferences) => void): void {
  onHostMessage((message) => {
    if (message.type !== "preferences") return;
    setPanelState(message.preferences);
    listener(message.preferences);
  });
}
