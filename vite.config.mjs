import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  root: fileURLToPath(new URL("./webview", import.meta.url)),
  base: "./",
  publicDir: "public",
  build: {
    outDir: fileURLToPath(new URL("./dist/webview", import.meta.url)),
    emptyOutDir: true,
  },
});
