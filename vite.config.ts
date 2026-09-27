import { defineConfig } from "vite";
export default defineConfig({
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:5174" },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (
            id.includes("node_modules/@codemirror") ||
            id.includes("node_modules/@lezer")
          )
            return "writing";
        },
      },
    },
  },
  test: { environment: "jsdom", include: ["tests/**/*.test.ts"] },
});
