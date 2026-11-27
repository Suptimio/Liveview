// Floating tool bubble on the left: expands into a vertical icon rail of editor actions.
// Every action shows a small tooltip with its name and a preview of what it produces.
import type { EditorAction, EditorContext } from "../actions/types";
import { icons } from "../icons";

export function setupToolMenu(editor: EditorContext, actions: EditorAction[]): HTMLElement {
  const root = document.createElement("nav");
  root.className = "tool-menu";
  root.setAttribute("aria-label", "Editor tools");

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "tool-menu-toggle";
  toggle.title = "Tools";
  toggle.setAttribute("aria-label", "Editor tools");
  toggle.setAttribute("aria-expanded", "false");
  toggle.setAttribute("aria-controls", "tool-menu-items");
  toggle.innerHTML = icons.tools;

  const list = document.createElement("div");
  list.id = "tool-menu-items";
  list.className = "tool-menu-items";
  list.setAttribute("role", "toolbar");
  list.setAttribute("aria-orientation", "vertical");

  const entries: { action: EditorAction; button: HTMLButtonElement; hint: HTMLElement }[] = [];
  const groups = new Map<string, HTMLElement>();
  for (const action of actions) {
    let group = groups.get(action.group);
    if (!group) {
      group = document.createElement("div");
      group.className = "tool-menu-group";
      group.setAttribute("role", "group");
      group.setAttribute("aria-label", action.group);
      groups.set(action.group, group);
      list.append(group);
    }

    const button = document.createElement("button");
    button.type = "button";
    button.className = "tool-menu-item";
    button.dataset.action = action.id;
    button.setAttribute("aria-label", action.label);
    button.innerHTML = action.icon;

    const tip = document.createElement("span");
    tip.className = "tool-tip";
    tip.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    label.className = "tool-tip-label";
    label.textContent = action.label;
    const hint = document.createElement("span");
    hint.className = "tool-tip-hint";
    tip.append(label, hint);
    button.append(tip);

    group.append(button);
    entries.push({ action, button, hint });
  }

  root.append(toggle, list);

  /** Enables/disables actions for the current caret position. */
  function refresh(): void {
    for (const { action, button, hint } of entries) {
      const enabled = action.isEnabled?.(editor) ?? true;
      button.setAttribute("aria-disabled", String(!enabled));
      hint.textContent = enabled ? action.hint : (action.disabledReason ?? action.hint);
    }
  }

  function setOpen(open: boolean): void {
    if (open) refresh();
    root.classList.toggle("is-open", open);
    toggle.setAttribute("aria-expanded", String(open));
    toggle.innerHTML = open ? icons.close : icons.tools;
  }

  // Keep the caret in the editor: pressing a menu button must not move focus/selection.
  root.addEventListener("pointerdown", (event) => event.preventDefault());
  root.addEventListener("pointerenter", refresh);
  root.addEventListener("focusin", refresh);
  toggle.addEventListener("click", () => setOpen(!root.classList.contains("is-open")));
  list.addEventListener("click", (event) => {
    const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>(".tool-menu-item") : null;
    const entry = entries.find((candidate) => candidate.button === button);
    if (!entry || button?.getAttribute("aria-disabled") === "true") return;
    entry.action.run(editor);
    refresh();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && root.classList.contains("is-open")) setOpen(false);
  });

  refresh();
  document.body.append(root);
  return root;
}
