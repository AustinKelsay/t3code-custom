import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { defineConfig } from "vite";
import { version } from "./package.json" with { type: "json" };

const port = Number(process.env.PORT ?? 5733);
const sourcemapEnv = process.env.T3CODE_WEB_SOURCEMAP?.trim().toLowerCase();
const bindHostEnv = process.env.VITE_HOST?.trim() || process.env.T3CODE_HOST?.trim();
const publicHostEnv =
  process.env.VITE_HMR_HOST?.trim() || process.env.T3CODE_PUBLIC_HOST?.trim() || bindHostEnv;

const bindHost =
  bindHostEnv && bindHostEnv !== "0.0.0.0" && bindHostEnv !== "::" ? bindHostEnv : true;
const hmrHost =
  publicHostEnv && publicHostEnv !== "0.0.0.0" && publicHostEnv !== "::"
    ? publicHostEnv
    : "localhost";

const buildSourcemap =
  sourcemapEnv === "0" || sourcemapEnv === "false"
    ? false
    : sourcemapEnv === "hidden"
      ? "hidden"
      : true;

export default defineConfig({
  plugins: [
    tanstackRouter(),
    react({
      babel: {
        plugins: [["babel-plugin-react-compiler", { target: "19" }]],
      },
    }),
    tailwindcss(),
  ],
  optimizeDeps: {
    include: ["@pierre/diffs", "@pierre/diffs/react", "@pierre/diffs/worker/worker.js"],
  },
  define: {
    // In dev mode, tell the web app where the WebSocket server lives
    "import.meta.env.VITE_WS_URL": JSON.stringify(process.env.VITE_WS_URL ?? ""),
    "import.meta.env.APP_VERSION": JSON.stringify(version),
  },
  resolve: {
    tsconfigPaths: true,
  },
  server: {
    host: bindHost,
    port,
    strictPort: true,
    hmr: {
      // Explicit config so Vite's HMR WebSocket connects reliably
      // inside Electron's BrowserWindow. Vite 8 uses console.debug for
      // connection logs — enable "Verbose" in DevTools to see them.
      protocol: "ws",
      host: hmrHost,
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: buildSourcemap,
  },
});
