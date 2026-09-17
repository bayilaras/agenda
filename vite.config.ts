import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import pagesConfig from "./pages.config.json";
export default defineConfig(({ mode }) => {
  return {
    plugins: [react()],
    base: mode === "pages" ? process.env.PAGES_BASE_PATH || "/agenda/" : "/",
    define:
      mode === "pages"
        ? {
            "import.meta.env.VITE_GOOGLE_CLIENT_ID": JSON.stringify(
              process.env.VITE_GOOGLE_CLIENT_ID ||
                loadEnv(mode, process.cwd(), "VITE_").VITE_GOOGLE_CLIENT_ID ||
                pagesConfig.googleClientId,
            ),
          }
        : {},
    server: {
      port: 5173,
      strictPort: true,
      proxy: mode === "pages" ? undefined : { "/api": "http://127.0.0.1:3001" },
    },
    build: { outDir: mode === "pages" ? "dist-pages" : "dist" },
  };
});
