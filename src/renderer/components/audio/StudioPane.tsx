import { BookOpen, CheckCircle2, Headphones, Loader2, Mic2, ServerCog, SlidersHorizontal, SpellCheck } from "lucide-react"
import { useMemo, useState, type ReactNode } from "react"
import { GenerationControls } from "@renderer/components/audio/GenerationControls"
import { JobQueue } from "@renderer/components/audio/JobQueue"
import { PronunciationManager } from "@renderer/components/audio/PronunciationManager"
import { VoiceManager } from "@renderer/components/audio/VoiceManager"
import { useGenerationConfig } from "@renderer/app/useGenerationConfig"
import type { TranslationFn } from "@renderer/app/types"
import { cn } from "@renderer/lib/utils"
import type { AudioSettings, BookSummary, LibraryAudioStatus, PronunciationEntry, RuntimeModel, TtsJob, VoiceProfile } from "@renderer/types"

export function StudioPane({
  audioStatus,
  audioSettings,
  books,
  enginesContent,
  jobs,
  loading,
  models,
  voices,
  t,
  onCancelJob,
  onClearFinished,
  onCreateVoiceFromDesignPrompt,
  onCreateVoiceFromReference,
  onCreatePronunciation,
  onDeletePronunciation,
  onDeleteVoice,
  onExportVoice,
  onImportVoices,
  onListPronunciation,
  onOpenBook,
  onPauseJob,
  onPreviewVoice,
  onResumeJob,
  onRetryJob,
  onSelectVoiceReferenceAudio,
  onUpdateAudioSettings,
  onUpdateVoice
}: {
  audioStatus: LibraryAudioStatus[]
  audioSettings: AudioSettings
  books: BookSummary[]
  enginesContent: ReactNode
  jobs: TtsJob[]
  loading: boolean
  models: RuntimeModel[]
  voices: VoiceProfile[]
  t: TranslationFn
  onCancelJob: (jobId: string) => Promise<void> | void
  onClearFinished: () => Promise<void> | void
  onCreateVoiceFromDesignPrompt: (input: {
    engineId: string
    language: string
    name: string
    prompt: string
    referenceVoiceProfileId?: string
    sampleText: string
  }) => Promise<VoiceProfile | void> | VoiceProfile | void
  onCreateVoiceFromReference: (input: {
    consentConfirmed: true
    consentNote: string
    language: string
    name: string
    referenceAudioPath: string
    transcript?: string
  }) => Promise<VoiceProfile | void> | VoiceProfile | void
  onCreatePronunciation: (input: { bookId?: string; pattern: string; replacement: string; scope: "global" | "book" }) => Promise<void>
  onDeletePronunciation: (id: string) => Promise<void>
  onDeleteVoice: (voiceProfileId: string) => Promise<void> | void
  onExportVoice: (voiceProfileId: string) => Promise<void> | void
  onImportVoices: () => Promise<void> | void
  onListPronunciation: (bookId?: string) => Promise<PronunciationEntry[]>
  onOpenBook: (bookId: string) => void
  onPauseJob: (jobId: string) => Promise<void> | void
  onPreviewVoice: (voiceProfileId: string, engineId: string) => Promise<string | null>
  onResumeJob: (jobId: string) => Promise<void> | void
  onRetryJob: (jobId: string) => Promise<void> | void
  onSelectVoiceReferenceAudio: () => Promise<{ path: string; durationMs?: number; sampleRate?: number } | null>
  onUpdateAudioSettings: (audioSettings: AudioSettings, delay?: number) => Promise<void> | void
  onUpdateVoice: (input: { voiceProfileId: string; name: string }) => Promise<void> | void
}) {
  const [tab, setTab] = useState<"books" | "voices" | "pronunciation" | "engines" | "preferences">("books")
  const prefsConfig = useGenerationConfig({ audioSettings, models, voices, t, onUpdateAudioSettings })
  const booksById = useMemo(() => new Map(books.map((book) => [book.id, book])), [books])
  const titleById = useMemo(() => new Map(audioStatus.map((item) => [item.bookId, item.title])), [audioStatus])
  const withAudio = useMemo(() => audioStatus.filter((item) => item.hasChapterAudio), [audioStatus])
  const withoutAudio = useMemo(() => audioStatus.filter((item) => !item.hasChapterAudio), [audioStatus])

  return (
    <div className="h-full min-h-0 overflow-auto">
      <div className="mx-auto w-full max-w-5xl space-y-8 px-6 py-6">
        <header className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold leading-tight">{t("audioDashboard.title")}</h1>
            <p className="text-xs text-muted-foreground">{t("audioDashboard.subtitle")}</p>
          </div>
          {loading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" /> : null}
        </header>

        <div className="flex flex-wrap gap-1 rounded-md border bg-card p-1 sm:inline-flex sm:w-auto">
          <button
            className={cn("inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-sm px-4 text-sm text-muted-foreground sm:flex-none", tab === "books" && "bg-background text-foreground shadow-sm")}
            onClick={() => setTab("books")}
          >
            <Headphones className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{t("studio.tab.overview")}</span>
          </button>
          <button
            className={cn("inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-sm px-4 text-sm text-muted-foreground sm:flex-none", tab === "voices" && "bg-background text-foreground shadow-sm")}
            onClick={() => setTab("voices")}
          >
            <Mic2 className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{t("audioDashboard.tab.voices")}</span>
          </button>
          <button
            className={cn("inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-sm px-4 text-sm text-muted-foreground sm:flex-none", tab === "pronunciation" && "bg-background text-foreground shadow-sm")}
            onClick={() => setTab("pronunciation")}
          >
            <SpellCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{t("studio.tab.pronunciation")}</span>
          </button>
          <button
            className={cn("inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-sm px-4 text-sm text-muted-foreground sm:flex-none", tab === "engines" && "bg-background text-foreground shadow-sm")}
            onClick={() => setTab("engines")}
          >
            <ServerCog className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{t("studio.tab.engines")}</span>
          </button>
          <button
            className={cn("inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-sm px-4 text-sm text-muted-foreground sm:flex-none", tab === "preferences" && "bg-background text-foreground shadow-sm")}
            onClick={() => setTab("preferences")}
          >
            <SlidersHorizontal className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{t("studio.tab.preferences")}</span>
          </button>
        </div>

        {tab === "engines" ? (
          enginesContent
        ) : tab === "preferences" ? (
          <section className="space-y-3">
            <p className="text-xs text-muted-foreground">{t("studio.preferences.hint")}</p>
            <GenerationControls config={prefsConfig} t={t} />
          </section>
        ) : tab === "pronunciation" ? (
          <PronunciationManager
            books={books}
            loading={loading}
            t={t}
            onListPronunciation={onListPronunciation}
            onCreatePronunciation={onCreatePronunciation}
            onDeletePronunciation={onDeletePronunciation}
          />
        ) : tab === "voices" ? (
          <VoiceManager
            voices={voices}
            models={models}
            loading={loading}
            t={t}
            onCreateVoiceFromReference={onCreateVoiceFromReference}
            onCreateVoiceFromDesignPrompt={onCreateVoiceFromDesignPrompt}
            onUpdateVoice={onUpdateVoice}
            onDeleteVoice={onDeleteVoice}
            onExportVoice={onExportVoice}
            onImportVoices={onImportVoices}
            onSelectVoiceReferenceAudio={onSelectVoiceReferenceAudio}
            onPreviewVoice={onPreviewVoice}
          />
        ) : (
          <>
            <JobQueue
              jobs={jobs}
              loading={loading}
              t={t}
              describeJob={(job) => ({ title: titleById.get(job.bookId) ?? job.bookId, subtitle: job.chapterHref })}
              onCancelJob={onCancelJob}
              onPauseJob={onPauseJob}
              onResumeJob={onResumeJob}
              onRetryJob={onRetryJob}
              onClearFinished={onClearFinished}
            />

            <BookGroup
              title={t("audioDashboard.withAudio")}
              emptyMessage={t("audioDashboard.withAudioEmpty")}
              emptyIcon={CheckCircle2}
              items={withAudio}
              booksById={booksById}
              t={t}
              onOpenBook={onOpenBook}
            />

            <BookGroup
              title={t("audioDashboard.withoutAudio")}
              emptyMessage={t("audioDashboard.withoutAudioEmpty")}
              emptyIcon={BookOpen}
              items={withoutAudio}
              booksById={booksById}
              t={t}
              onOpenBook={onOpenBook}
            />
          </>
        )}
      </div>
    </div>
  )
}

function BookGroup({
  title,
  emptyMessage,
  emptyIcon,
  items,
  booksById,
  t,
  onOpenBook
}: {
  title: string
  emptyMessage: string
  emptyIcon: typeof BookOpen
  items: LibraryAudioStatus[]
  booksById: Map<string, BookSummary>
  t: TranslationFn
  onOpenBook: (bookId: string) => void
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        <span className="text-xs text-muted-foreground">{items.length}</span>
      </div>
      {items.length ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {items.map((item) => (
            <BookCard key={item.bookId} item={item} book={booksById.get(item.bookId)} t={t} onOpenBook={onOpenBook} />
          ))}
        </div>
      ) : (
        <EmptyState icon={emptyIcon} message={emptyMessage} />
      )}
    </section>
  )
}

function BookCard({
  item,
  book,
  t,
  onOpenBook
}: {
  item: LibraryAudioStatus
  book?: BookSummary
  t: TranslationFn
  onOpenBook: (bookId: string) => void
}) {
  return (
    <button
      className="flex items-stretch gap-3 rounded-md border bg-card p-3 text-left transition hover:border-primary"
      onClick={() => onOpenBook(item.bookId)}
    >
      <div
        className="flex h-16 w-11 shrink-0 items-center justify-center overflow-hidden rounded-sm border bg-muted"
        style={book?.coverImageUrl ? undefined : { backgroundColor: book?.coverColor }}
      >
        {book?.coverImageUrl ? (
          <img className="h-full w-full object-cover" src={book.coverImageUrl} alt="" />
        ) : (
          <BookOpen className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-between">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{item.title}</p>
          {item.authors.length ? <p className="mt-0.5 truncate text-xs text-muted-foreground">{item.authors.join(", ")}</p> : null}
        </div>
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            {t("audioDashboard.chapterProgress", { ready: item.chaptersReady, total: item.chaptersTotal })}
          </span>
          {item.hasActiveJob ? (
            <span className="inline-flex items-center gap-1 text-xs text-primary">
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
              {t("audioDashboard.statusActive")}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">{t(`audioDashboard.status.${item.status}`)}</span>
          )}
        </div>
      </div>
    </button>
  )
}

function EmptyState({ icon: Icon, message }: { icon: typeof BookOpen; message: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-dashed bg-card/50 p-4 text-sm text-muted-foreground">
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{message}</span>
    </div>
  )
}
