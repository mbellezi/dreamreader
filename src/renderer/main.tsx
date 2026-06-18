import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "@renderer/App"
import "@edrlab/thorium-web/misc/styles"
import "@edrlab/thorium-web/reader/styles"
import "@renderer/index.css"

const rootElement = document.getElementById("root")

if (!rootElement) {
  throw new Error("DreamReader root element was not found")
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>
)
