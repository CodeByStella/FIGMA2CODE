import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import react from "@vitejs/plugin-react-swc";

const repoRoot = path.dirname(fileURLToPath(import.meta.url));
const repoDist = path.resolve(repoRoot, "dist");

const watchIgnored = ["**/dist/**", "**/node_modules/**", "**/.git/**"];

export default defineConfig({
  root: "./src/ui",
  plugins: [react(), viteSingleFile()],
  resolve: {
    alias: {
      types: path.resolve(repoRoot, "src/types/index.ts"),
    },
  },
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
