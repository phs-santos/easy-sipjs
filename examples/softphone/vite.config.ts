import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import path from "path";

export default defineConfig({
  server: { host: "::", port: 2122 },
  plugins: [vue()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
});
