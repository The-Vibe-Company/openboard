import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { routerOptions } from "./router.options.ts";

const api = "http://127.0.0.1:8787";

export default defineConfig({
  plugins: [tanstackRouter(routerOptions), react()],
  server: {
    host: "localhost",
    port: 5173,
    strictPort: true,
    proxy: { "^/api(?:[/?]|$)": api, "^/auth(?:[/?]|$)": api },
  },
});
