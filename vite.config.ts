import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: {
    target: "es2022",
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          playcanvas: ["playcanvas"],
        },
      },
    },
  },
  server: {
    host: true,
    port: 5173,
  },
});
