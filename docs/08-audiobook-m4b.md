# Audiobook M4B

## Objective

Create one M4B file per book as chapter audio is generated. The user should be able to listen to/export a partial audiobook while the rest of the book remains queued.

## Principles

- The M4B is derived, not canonical.
- Canonical sources are chapter audio, manifests, and database metadata.
- Updates must be atomic: create a temporary file, validate it, and replace the previous file.
- An M4B assembly failure does not invalidate chapter audio.
- The app must be able to rebuild the M4B at any time.

## Flow

1. TTS completes a chapter.
2. The chapter is saved as an audio asset with duration, codec, voice, engine, and hash.
3. `audiobook_chapters` is updated.
4. `audiobook_exports.stale` becomes `true`.
5. If auto-build is enabled, the assembler is queued.
6. The assembler creates a temporary M4B with ready chapters.
7. The app validates duration, chapters, and metadata.
8. The temporary file replaces the previous draft.
9. If all selected chapters are ready, the export may be marked final.

## Partial versus Final

### Partial M4B

- Contains only chapters that have already been generated.
- May be replaced several times.
- Must clearly indicate that it is incomplete.
- Must retain chapter markers for included chapters.

### Final M4B

- Contains all selected chapters.
- Should remain stable until audio, voice, engine, cover, order, or metadata changes.
- May be rebuilt manually by the user.

## Metadata

Minimum fields:

- title
- authors
- language
- cover
- generation date
- TTS engine
- voice/profile
- total duration
- chapters with title, start, and end

Optional fields:

- subtitle
- publisher
- publication year
- description
- narrator/voice
- note about local generation

## Codec and Container

Initial direction:

- Intermediate: WAV per segment for debugging and assembly.
- Chapter: M4A/AAC when an encoder is available.
- Book: M4B with AAC and chapter markers.

If encoding/packaging is not ready for the MVP, the app may keep WAV/M4A per chapter and leave M4B as a pending job without blocking audio generation.

## Invalidation

Mark the export as `stale` when:

- a chapter is regenerated;
- the voice changes;
- the engine/model changes;
- the normalizer or prosody changes and affects audio;
- chapter order changes;
- cover/metadata changes;
- encoder/quality configuration changes.

## UI

- Show per-book status: no audio, partial, outdated, complete, or error.
- Show progress: ready chapters/total and ready duration.
- Provide an M4B rebuild action with build status/progress.
- Provide an auto-build toggle per book and globally.
- Provide an action to save the M4B file to a path chosen by the user.
- Warn when a partial M4B does not contain all chapters.

## Jobs

States:

- `queued`
- `building`
- `validating`
- `completed`
- `failed`
- `cancelled`

Priority:

- Low by default.
- Must never interrupt reading/player activity.
- May pause if TTS needs CPU/I/O.

## Tests

- Assemble an M4B with one chapter.
- Update the M4B after adding another chapter.
- Regenerate a chapter with another voice and confirm `stale`.
- Rebuild a final export with cover and markers.
- Cancel a build without corrupting the previous draft.
- Simulate an encoder failure and preserve chapter audio.
