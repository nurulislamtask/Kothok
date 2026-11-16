import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri on Windows renders with WebView2 (Chromium), so a modern target is safe.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: { target: "chrome105", sourcemap: false },
});
