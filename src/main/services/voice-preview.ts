import type { NarrationPlan } from "@shared/contracts/ai"
import { hashBuffer } from "@main/lib/hash"
import { neutralProsodyFor } from "@main/services/tts-pipeline"

export function buildPreviewPlan(voiceProfileId: string, engineId: string, language: string): NarrationPlan {
  const text = language === "en" ? "This is a short DreamReader voice preview." : "Esta é uma prévia curta da voz no DreamReader."
  const contentHash = hashBuffer(`${voiceProfileId}:${engineId}:${language}:${text}`)
  return {
    schemaVersion: "narration-plan/v1",
    source: {
      bookId: "voice-preview",
      chapterHref: `${voiceProfileId}:${engineId}`,
      contentHash,
      language
    },
    normalization: {
      normalizerId: "voice-preview",
      version: "1.0.0",
      dictionaryVersion: "preview"
    },
    prosody: {
      analyzerId: "voice-preview",
      version: "1.0.0"
    },
    segments: [
      {
        segmentId: `voice-preview:${contentHash.slice(0, 12)}`,
        locator: {
          href: "voice-preview",
          locations: {
            progression: 0,
            segmentIndex: 0
          }
        },
        originalText: text,
        normalizedText: text,
        voiceRole: "narrator",
        prosody: neutralProsodyFor(text)
      }
    ]
  }
}
