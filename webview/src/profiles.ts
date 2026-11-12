export type RenderProfile = "basic" | "github" | "gitlab" | "vscode";

const profiles: RenderProfile[] = ["basic", "github", "gitlab", "vscode"];

let activeProfile: RenderProfile = "basic";

export function getRenderProfile(): RenderProfile {
  return activeProfile;
}

export function isRenderProfile(profile: unknown): profile is RenderProfile {
  return profiles.some((knownProfile) => knownProfile === profile);
}

export function setRenderProfile(profile: RenderProfile): void {
  if (!isRenderProfile(profile)) {
    throw new Error(`Unknown render profile: ${profile}`);
  }

  activeProfile = profile;
  document.documentElement.dataset.profile = profile;
}
