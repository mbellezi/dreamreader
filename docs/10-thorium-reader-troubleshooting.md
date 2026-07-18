# Thorium/Readium Reader — Pitfalls and Troubleshooting

This document records non-obvious findings about the EPUB reader
(`@edrlab/thorium-web` + `@readium/navigator`) that have already caused the bug
“reader stuck on the cover, with no pagination or table-of-contents navigation.”

Read this before changing:

- `src/renderer/components/thorium/ThoriumReaderPane.tsx`
- `src/renderer/main.tsx` (React mount)
- `src/main/protocol/asset-protocol.ts` (`dreamreader://` protocol + manifest/positions)
- CSP in `src/renderer/index.html`

## How the Reader Works (Mental Model)

- Each spine resource is rendered in an `<iframe>` whose content is a `blob:` URL assembled by `FrameBlobBuilder` (it does **not** load `dreamreader://` directly in the iframe). The blob inherits the renderer origin, so the iframe is **same-origin** with the app.
- Readium drives this iframe from the parent realm (renderer) through direct DOM access (`contentWindow.addEventListener`, `contentDocument`). The iframe therefore needs to be same-origin and keep `sandbox="allow-same-origin allow-scripts"`.
- Column pagination and the `go_next`/`go_prev`/`go()` commands are implemented by injectables (`ColumnSnapper`, etc.). If they fail to mount, navigation silently stops working.
- Navigation data (`readingOrder`, `toc`, `positions`) comes from the Readium manifest rewritten in `asset-protocol.ts`, all as `dreamreader://publication/<id>/resource/<path>`. Href matching uses exact string comparison (`Link.findWithHref`), and has been verified as correct.

## Bug 1 — Sandbox Without `allow-scripts`

A patch (`installReadiumIframeSandboxPatch`) forced
`sandbox="allow-same-origin"` on `.readium-navigator-iframe` iframes, removing
`allow-scripts`. Without scripts, injectables do not mount: pagination dies and
clicking the table of contents does not leave the cover. The cover still appears
because image/native iframe rendering does not depend on scripts.

**Rule:** never re-sandbox Readium content iframes to remove `allow-scripts`. This conflicts with the “EPUB is untrusted” rule in `RULES.md`, but Readium requires scripts in the content; it is an inherent trade-off of the selected reader. Readium itself injects a restrictive CSP inside the blob.

## Bug 2 — React StrictMode Duplicates the Navigator (What Actually Kept the Cover Visible)

With `<StrictMode>` in `main.tsx`, React mounts the reader twice in **development**. As a result, `EpubNavigator.load()` runs twice and **two navigators** append iframes to the **same container**. The orphan navigator leaves the cover iframe `visibility:visible` on top, hiding the working navigator underneath. Navigation works internally (`currentLocator` changes), but the screen never changes.

This happens only in dev (StrictMode does not re-invoke effects in a production build). Teardown of `StatefulReaderWrapper` is not ours to fix.

**Applied fix:** remove `<StrictMode>` from `src/renderer/main.tsx` (see the comment in that file). Do not add it back without first ensuring that the reader survives double mounting.

## How to Troubleshoot Navigation Problems

1. **`ColumnSnapper Mounted` in the renderer console** — if it does not appear, injectables did not mount (suspect sandbox/scripts/origin).
2. **Count `EpubNavigator.load()`** — it must be 1 per opened book. 2 means double mounting (StrictMode/remount).
3. **Count visible iframes** — `document.querySelectorAll('iframe.readium-navigator-iframe')` with `visibility:visible` must return exactly 1.
4. **Check the VISIBLE iframe, not only `currentLocator`** — calling `navigator.goForward()` and inspecting `currentLocator` can mislead: it advances internally even while an orphan cover hides the screen. Inspect the visible iframe content (`contentDocument.body.textContent`).
5. To reproduce without the screen, open the reader by code (default view + `selectedBook`) and instrument `EpubNavigator.prototype`. Always **remove the instrumentation** when finished.

## Development PGlite Database Is Fragile

- The dev database is at `.dreamreader-dev/db/pglite`.
- It can become corrupt (`Aborted(). Build with -sASSERTIONS`) if Electron is killed (SIGKILL/SIGTERM) during a write, or if another Node process opens the same directory while the app is running. The app currently **does not close PGlite on quit** (`src/main/index.ts` has no `before-quit`) — this is a recommended improvement.
- Reading-position writes happen on every page turn; tests that navigate by code generate these writes. For safe testing, avoid killing the app immediately after navigating.
- **Recovery** (only the DB is lost; EPUBs remain at
  `~/Library/Application Support/DreamReader/library/books/<sha256>.epub`): move the corrupt directory aside, run `npm run db:migrate`, and reinsert the `books` rows. The filename (hex) **is** the `content_hash`. The reader serves content directly from the zip through `library_path`, so only the `books` row is needed to read (no `assets` row is required). The stored `manifest_json` (`readiumManifest` field) uses relative hrefs, independent of the book ID.

## Known Follow-ups (Outside the Original Bug Scope)

- Close PGlite in `before-quit` to avoid corruption on abrupt exits.
- Google Fonts (`fonts.googleapis.com`) are blocked by the reader CSP and fall back to a system font. Prefer bundled fonts, aligned with the local-first design.
