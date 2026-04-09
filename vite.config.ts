import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { spawn, type ChildProcess } from "child_process";
import { resolve } from "path";
import type { Plugin } from "vite";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

/** Vite plugin that auto-starts the rtsp-proxy HLS server alongside dev. */
function hlsProxyPlugin(): Plugin {
  let proxyProcess: ChildProcess | null = null;
  return {
    name: "hls-proxy",
    configureServer() {
      const proxyDir = resolve(__dirname, "rtsp-proxy");
      const serverFile = resolve(proxyDir, "server.js");
      try {
        proxyProcess = spawn("node", [serverFile], {
          cwd: proxyDir,
          stdio: ["ignore", "pipe", "pipe"],
          shell: false,
        });
        proxyProcess.stdout?.on("data", (d: Buffer) =>
          console.log(`[hls-proxy] ${d.toString().trim()}`)
        );
        proxyProcess.stderr?.on("data", (d: Buffer) =>
          console.error(`[hls-proxy] ${d.toString().trim()}`)
        );
        proxyProcess.on("error", (err) =>
          console.error(`[hls-proxy] spawn error: ${err.message}`)
        );
        proxyProcess.on("close", (code) =>
          console.log(`[hls-proxy] exited (code ${code})`)
        );
        console.log("[hls-proxy] Auto-started rtsp-proxy/server.js");
      } catch (e) {
        console.error("[hls-proxy] Failed to start:", e);
      }
    },
    buildEnd() {
      if (proxyProcess && !proxyProcess.killed) {
        proxyProcess.kill();
        proxyProcess = null;
      }
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), hlsProxyPlugin()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri` and rtsp-proxy (ffmpeg writes files there constantly)
      ignored: ["**/src-tauri/**", "**/rtsp-proxy/**", "**/dist/**"],
    },
  },
});
