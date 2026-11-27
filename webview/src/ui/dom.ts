// Small DOM lookup helpers that fail loudly when the page markup and the code drift apart.

export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id}.`);
  return node as T;
}

export function query<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T {
  const node = root.querySelector<T>(selector);
  if (!node) throw new Error(`Missing ${selector}.`);
  return node;
}
