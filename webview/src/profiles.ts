export type RenderProfile = "github" | "gitlab" | "vscode";

const profiles: RenderProfile[] = ["github", "gitlab", "vscode"];

let activeProfile: RenderProfile = "github";

export function getRenderProfile(): RenderProfile {
  return activeProfile;
}

export function setRenderProfile(profile: RenderProfile): void {
  if (!profiles.includes(profile)) {
    throw new Error(`Unknown render profile: ${profile}`);
  }

  activeProfile = profile;
  document.documentElement.dataset.profile = profile;
}
