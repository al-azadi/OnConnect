import { defineConfig } from "vite";

export default defineConfig({
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:7000",
        changeOrigin: true,
      },
      "/admin": {
        target: "http://127.0.0.1:7000",
        changeOrigin: true,
      },
      "/media": {
        target: "http://127.0.0.1:7000",
        changeOrigin: true,
      },
    },
  },
});
