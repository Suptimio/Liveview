async function embedLocalImages(paper: HTMLElement): Promise<void> {
  const documentBase = document.documentElement.dataset.documentBase;
  if (!documentBase) return;
  const base = new URL(documentBase);

  for (const image of paper.querySelectorAll<HTMLImageElement>("img")) {
    const source = image.getAttribute("src");
    if (!source) continue;
    const url = new URL(source, base);
    if (url.protocol !== base.protocol || url.host !== base.host) continue;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Could not load image for PDF export: ${url.pathname}`);
    }
    const blob = await response.blob();
    image.src = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener("load", () => {
        if (typeof reader.result === "string") resolve(reader.result);
        else reject(new Error("Could not encode an image for PDF export."));
      });
      reader.addEventListener("error", () => reject(reader.error));
      reader.readAsDataURL(blob);
    });
  }
}

/** Copy of `node` with shadow roots inlined (their CSS collected in `shadowStyles`) and editor-only bits removed. */
export function cloneForExport(node: Node, shadowStyles: Set<string>): Node | undefined {
  if (node instanceof Element) {
    if (["SCRIPT", "IFRAME", "OBJECT", "EMBED"].includes(node.tagName)) return;
    if (node.matches(".source, .edit-html, .line-hint, .html-line-edit, [data-caret-placeholder]")) return;

    const clone = node.cloneNode(false) as Element;
    clone.removeAttribute("data-active");
    for (const attribute of [...clone.attributes]) {
      if (attribute.name.toLowerCase().startsWith("on")) clone.removeAttribute(attribute.name);
      if (
        ["href", "src", "xlink:href"].includes(attribute.name.toLowerCase()) &&
        /^\s*javascript:/i.test(attribute.value)
      ) {
        clone.removeAttribute(attribute.name);
      }
    }

    const children = node.shadowRoot ? node.shadowRoot.childNodes : node.childNodes;
    for (const child of children) {
      if (child instanceof HTMLStyleElement) {
        shadowStyles.add(
          child.textContent?.replace(/:host\(([^)]+)\)/g, ".export-shadow-host$1")
            .replaceAll(":host", ".export-shadow-host") ?? "",
        );
        continue;
      }
      const childClone = cloneForExport(child, shadowStyles);
      if (childClone) clone.append(childClone);
    }

    if (node.shadowRoot) clone.classList.add("export-shadow-host");
    return clone;
  }

  return node.cloneNode();
}

function encodeBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

export async function createPdf(paper: HTMLElement): Promise<string> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import("html2canvas"),
    import("jspdf"),
  ]);
  const shadowStyles = new Set<string>();
  const clone = cloneForExport(paper, shadowStyles);
  if (!(clone instanceof HTMLElement)) {
    throw new Error("Could not prepare the rendered Markdown for PDF export.");
  }

  const width = Math.ceil(paper.getBoundingClientRect().width);
  if (!width) throw new Error("The rendered Markdown has no printable width.");

  const staging = document.createElement("div");
  staging.style.cssText = `position:fixed;top:0;left:-100000px;z-index:-1;width:${width}px;overflow:visible;`;
  for (const css of shadowStyles) {
    const style = document.createElement("style");
    style.textContent = css;
    staging.append(style);
  }
  clone.style.width = `${width}px`;
  clone.style.minHeight = "0";
  clone.style.margin = "0";
  // Borderless profiles paint the page with a huge paper-colored shadow; not wanted in the PDF.
  clone.style.boxShadow = "none";
  // Paper has no "click to expand": print every <details> block opened.
  for (const details of clone.querySelectorAll('[data-syntax="details"]')) {
    details.setAttribute("data-open", "");
  }
  clone.querySelector<HTMLElement>("#editor")?.style.setProperty("min-height", "0", "important");
  staging.append(clone);
  document.body.append(staging);

  try {
    await embedLocalImages(clone);
    await document.fonts.ready;
    const height = Math.ceil(clone.scrollHeight);
    if (!height) throw new Error("The rendered Markdown has no printable height.");

    const maxCanvasSide = 30000;
    const maxCanvasArea = 40_000_000;
    const scale = Math.min(
      2,
      maxCanvasSide / Math.max(width, height),
      Math.sqrt(maxCanvasArea / (width * height)),
    );
    const canvas = await html2canvas(clone, {
      backgroundColor: null,
      scale,
      logging: false,
      width,
      height,
      windowWidth: width,
      windowHeight: height,
      scrollX: 0,
      scrollY: 0,
    });
    const physicalScale = Math.min(1, 14000 / (Math.max(width, height) * 0.75));
    const widthMm = (width * physicalScale * 25.4) / 96;
    const heightMm = (height * physicalScale * 25.4) / 96;
    const pdf = new jsPDF({
      orientation: "portrait",
      unit: "mm",
      format: [widthMm, heightMm],
      compress: true,
    });
    pdf.addImage(canvas, "PNG", 0, 0, widthMm, heightMm, undefined, "FAST");
    return encodeBase64(pdf.output("arraybuffer"));
  } finally {
    staging.remove();
  }
}

export function setupExporter(
  button: HTMLButtonElement,
  paper: HTMLElement,
  sendExport: (base64: string) => void,
  sendError: (message: string) => void,
): void {
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      sendExport(await createPdf(paper));
    } catch (error) {
      sendError(error instanceof Error ? error.message : String(error));
    } finally {
      button.disabled = false;
    }
  });
}
