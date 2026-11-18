import { defineConfig } from "vite";


const API = process.env.VITE_API_TARGET ?? "http://127.0.0.1:7000";

export default defineConfig({
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": { target: API, changeOrigin: true },
      "/admin": { target: API, changeOrigin: true },
      "/media": { target: API, changeOrigin: true },
    },
  },
});
