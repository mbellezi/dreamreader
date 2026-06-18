import { createRoot } from "react-dom/client"
import { App } from "@renderer/App"
import "@edrlab/thorium-web/misc/styles"
import "@edrlab/thorium-web/reader/styles"
import "@renderer/index.css"

const rootElement = document.getElementById("root")

if (!rootElement) {
  throw new Error("DreamReader root element was not found")
}

// React.StrictMode is intentionally not used here. The Thorium/Readium reader
// (StatefulReaderWrapper) builds an EpubNavigator that appends content iframes
// imperatively into a shared container. StrictMode's dev-only double-mount
// creates a second, orphaned navigator whose cover iframe stays visible on top,
// making the reader appear stuck on the cover (pagination and TOC navigation
// look broken even though they work underneath). See ThoriumReaderPane.
createRoot(rootElement).render(<App />)
