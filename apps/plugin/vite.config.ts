import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import react from "@vitejs/plugin-react-swc";

const pluginDir = path.dirname(fileURLToPath(import.meta.url));
const repoDist = path.resolve(pluginDir, "../../dist");

// emptyOutDir is false so a UI rebuild does not delete esbuild's code.js.
// Vite then skips its default outDir ignore — exclude dist explicitly or
// writing index.html retriggers watch.
const watchIgnored = ["**/dist/**", "**/node_modules/**", "**/.git/**"];

// https://vitejs.dev/config/
export default defineConfig({
  root: "./ui-src",
  plugins: [react(), viteSingleFile()],
  server: {
    watch: {
      ignored: watchIgnored,
    },
  },
  build: {
    target: "es2017",
    assetsInlineLimit: 100000000,
    chunkSizeWarningLimit: 100000000,
    cssCodeSplit: false,
    outDir: repoDist,
    emptyOutDir: false,
    ...(process.argv.includes("--watch")
      ? { watch: { exclude: watchIgnored } }
      : {}),
    rollupOptions: {
      output: {},
    },
  },
});
