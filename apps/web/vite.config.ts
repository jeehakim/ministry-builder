import { defineConfig } from "vite";
import path from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ command }) => ({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  server: { port: 5173 },
  // Production bundles carry no console output or debugger statements; development keeps them.
  esbuild: command === "build" ? { drop: ["console", "debugger"] } : {},
}));
