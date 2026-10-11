import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const outDir = fileURLToPath(new URL("../src/brainwiki/viz/app", import.meta.url));

export default defineConfig({
  esbuild: { jsx: "automatic", jsxImportSource: "preact" },
  base: "/",
  build: {
    outDir,
    emptyOutDir: true,
    target: "es2022",
    cssCodeSplit: false,
    modulePreload: false,
    sourcemap: false,
    reportCompressedSize: false,
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      // One script and one stylesheet: `brain viz --export brain.html` inlines both.
      output: { inlineDynamicImports: true },
    },
  },
  server: {
    proxy: { "/api": process.env.BRAIN_VIZ_BACKEND ?? "http://127.0.0.1:8765" },
  },
});
