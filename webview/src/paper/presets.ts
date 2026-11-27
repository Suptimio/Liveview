// The built-in CSS shipped with Viewlife: the editable "Basic" preset and the profile sheets.
import type { RenderProfile } from "./profiles";
import githubProfileCss from "./profiles/github.css?inline";
import gitlabProfileCss from "./profiles/gitlab.css?inline";
import vscodeProfileCss from "./profiles/vscode.css?inline";
import baseStyleSource from "./style.css?raw";
import syntaxStyleSource from "./syntax.css?raw";
import githubProfileSource from "./profiles/github.css?raw";
import gitlabProfileSource from "./profiles/gitlab.css?raw";
import vscodeProfileSource from "./profiles/vscode.css?raw";

/** Everything the paper needs; shown in the CSS editor as the starting point for custom CSS. */
export const basicCss = [
  "/* Markdown syntax */",
  syntaxStyleSource,
  "/* GitHub profile */",
  githubProfileSource,
  "/* GitLab profile */",
  gitlabProfileSource,
  "/* VS Code profile */",
  vscodeProfileSource,
  "/* Base style.css */",
  baseStyleSource.replace(/^@import\s+["'][^"']+["'];\r?\n/gm, ""),
].join("\n\n");

/** Profile sheets alone, used by the mini preview. */
export const profileCss: Record<RenderProfile, string> = {
  basic: "",
  github: githubProfileCss,
  gitlab: gitlabProfileCss,
  vscode: vscodeProfileCss,
};
