import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import wails from "@wailsio/runtime/plugins/vite";

declare const process: { env: Record<string, string | undefined> };

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    host: "127.0.0.1",
    port: Number(process.env.WAILS_VITE_PORT) || 9245,
    strictPort: true,
  },
  plugins: [react(), tailwindcss(), wails("./bindings")],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: "monaco",
              test: /node_modules[\\/](monaco-editor|@monaco-editor)/,
              priority: 30,
            },
            {
              name: "react-vendor",
              test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/,
              priority: 25,
            },
            {
              name: "icons",
              test: /node_modules[\\/]lucide-react[\\/]/,
              priority: 20,
            },
            {
              name: "motion",
              test: /node_modules[\\/]framer-motion[\\/]/,
              priority: 20,
            },
            {
              name: "sql-formatter",
              test: /node_modules[\\/]sql-formatter[\\/]/,
              priority: 20,
            },
            {
              name: "tanstack",
              test: /node_modules[\\/]@tanstack[\\/]/,
              priority: 20,
            },
            {
              name: "vendor",
              test: /node_modules[\\/]/,
              priority: 10,
            },
          ],
        },
      },
    },
  },
});
