import { defineConfig, type UserConfig } from "vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";
import path from "node:path";

const isUITestBuild = process.env.FRONTEND_UI_TEST === "1";
export default defineConfig((): UserConfig => ({
  root: import.meta.dirname,
  base: "./",
  plugins: [react(), babel({ presets: [reactCompilerPreset()] })],
  resolve: { dedupe: ["react", "react-dom", "zustand", "i18next"], alias: { "@": path.resolve(import.meta.dirname, "./src"), "@shared": path.resolve(import.meta.dirname, "../src/shared") } },
  server: { port: 5173, strictPort: true, watch: { ignored: ["**/.playwright/**", "**/dist/**"] } },
  build: {
    emptyOutDir: true,
    outDir: path.resolve(import.meta.dirname, isUITestBuild ? "dist" : "../dist/renderer"), sourcemap: false,
    rolldownOptions: {
      input: isUITestBuild ? {
        app: path.resolve(import.meta.dirname, "index.html"),
        "update-popup": path.resolve(import.meta.dirname, "update-popup.html"),
        "tests/ui/client-contract-fixture": path.resolve(import.meta.dirname, "tests/ui/client-contract-fixture.html"),
      } : {app:path.resolve(import.meta.dirname,"index.html"),"update-popup":path.resolve(import.meta.dirname,"update-popup.html")},
      output: {
        minify: { compress: { dropConsole: !isUITestBuild, dropDebugger: true } },
      },
    },
    chunkSizeWarningLimit: 3000,
  },
}));
