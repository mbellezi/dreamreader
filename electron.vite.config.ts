import { resolve } from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, externalizeDepsPlugin } from "electron-vite"

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        "@main": resolve("src/main"),
        "@shared": resolve("src/shared")
      }
    },
    build: {
      rollupOptions: {
        external: ["node-llama-cpp"]
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        "@preload": resolve("src/preload"),
        "@shared": resolve("src/shared")
      }
    },
    build: {
      rollupOptions: {
        output: {
          entryFileNames: "[name].cjs",
          format: "cjs"
        }
      }
    }
  },
  renderer: {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@renderer": resolve("src/renderer"),
        "@shared": resolve("src/shared")
      }
    }
  }
})
