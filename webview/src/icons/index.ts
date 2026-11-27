// All UI icons, one SVG file each (24x24, stroke = currentColor; drawn by our own CSS).
import close from "./close.svg?raw";
import edit from "./edit.svg?raw";
import exportIcon from "./export.svg?raw";
import sortAz from "./sort-az.svg?raw";
import sortNumbers from "./sort-numbers.svg?raw";
import sortZa from "./sort-za.svg?raw";
import styles from "./styles.svg?raw";
import table from "./table.svg?raw";
import themeAuto from "./theme-auto.svg?raw";
import themeDark from "./theme-dark.svg?raw";
import themeLight from "./theme-light.svg?raw";
import tools from "./tools.svg?raw";

export const icons = {
  close,
  edit,
  export: exportIcon,
  "sort-az": sortAz,
  "sort-numbers": sortNumbers,
  "sort-za": sortZa,
  styles,
  table,
  "theme-auto": themeAuto,
  "theme-dark": themeDark,
  "theme-light": themeLight,
  tools,
};

export type IconName = keyof typeof icons;

/** Puts the icon named in `data-icon` in front of each such element's content (used by index.html). */
export function renderIcons(root: ParentNode = document): void {
  for (const element of root.querySelectorAll<HTMLElement>("[data-icon]")) {
    const svg = icons[element.dataset.icon as IconName];
    if (!svg) throw new Error(`Unknown icon: ${element.dataset.icon}`);
    element.insertAdjacentHTML("afterbegin", svg);
  }
}
