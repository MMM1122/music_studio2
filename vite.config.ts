import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
export default defineConfig({
  // Relative asset paths: the built app runs from a domain root or from a sub-folder
  // such as https://<user>.github.io/<repo>/ without further configuration.
  base: "./",
  plugins: [react()],
  test: { include: ["src/**/*.test.ts"], environment: "node" },
  build: { chunkSizeWarningLimit: 800 },
});
