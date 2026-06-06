import { defineConfig } from "vitest/config"
import { resolve } from "node:path"

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"]
  },
  resolve: {
    alias: {
      "@main": resolve("src/main"),
      "@preload": resolve("src/preload"),
      "@renderer": resolve("src/renderer"),
      "@shared": resolve("src/shared")
    }
  }
})

