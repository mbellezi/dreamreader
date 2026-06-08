import { BookOpen, CheckCircle2, CircleSlash, Headphones, Loader2, Mic2, Square } from "lucide-react"
import { useMemo, useState } from "react"
import { VoiceManager } from "@renderer/components/audio/VoiceManager"
import type { TranslationFn } from "@renderer/app/types"
import { cn } from "@renderer/lib/utils"
import type { BookSummary, LibraryAudioStatus, RuntimeModel, TtsJob, VoiceProfile } from "@renderer/types"

const INACTIVE_JOB_STATUSES = ["completed", "failed", "cancelled", "paused"]

export function AudioDashboardPane({
  audioStatus,
  books,
  jobs,
  loading,
  models,
  voices,
  t,
  onCancelJob,
  onCreateVoiceFromDesignPrompt,
  onCreateVoiceFromReference,
  onDeleteVoice,
  onOpenBook,
  onSelectVoiceReferenceAudio,
  onUpdateVoice
}: {
  audioStatus: LibraryAudioStatus[]
  books: BookSummary[]
  jobs: TtsJob[]
  loading: boolean
  models: RuntimeModel[]
  voices: VoiceProfile[]
  t: TranslationFn
  onCancelJob: (jobId: string) => Promise<void> | void
  onCreateVoiceFromDesignPrompt: (input: { engineId: string; language: string; name: string; prompt: string }) => Promise<VoiceProfile | void> | VoiceProfile | void
  onCreateVoiceFromReference: (input: {
    consentConfirmed: true
    consentNote: string
    language: string
    name: string
    referenceAudioPath: string
    transcript?: string
  }) => Promise<VoiceProfile | void> | VoiceProfile | void
  onDeleteVoice: (voiceProfileId: string) => Promise<void> | void
  onOpenBook: (bookId: string) => void
  onSelectVoiceReferenceAudio: () => Promise<{ path: string; durationMs?: number; sampleRate?: number } | null>
  onUpdateVoice: (input: { voiceProfileId: string; name: string }) => Promise<void> | void
}) {
  const [tab, setTab] = useState<"books" | "voices">("books")
  const booksById = useMemo(() => new Map(books.map((book) => [book.id, book])), [books])
  const titleById = useMemo(() => new Map(audioStatus.map((item) => [item.bookId, item.title])), [audioStatus])
  const activeJobs = useMemo(() => jobs.filter((job) => !INACTIVE_JOB_STATUSES.includes(job.status)), [jobs])
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

        <div className="grid grid-cols-2 gap-1 rounded-md border bg-card p-1 sm:inline-grid sm:w-auto sm:grid-cols-[auto_auto]">
          <button
            className={cn("inline-flex h-9 items-center justify-center gap-2 rounded-sm px-4 text-sm text-muted-foreground", tab === "books" && "bg-background text-foreground shadow-sm")}
            onClick={() => setTab("books")}
          >
            <Headphones className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{t("audioDashboard.tab.books")}</span>
          </button>
          <button
            className={cn("inline-flex h-9 items-center justify-center gap-2 rounded-sm px-4 text-sm text-muted-foreground", tab === "voices" && "bg-background text-foreground shadow-sm")}
            onClick={() => setTab("voices")}
          >
            <Mic2 className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{t("audioDashboard.tab.voices")}</span>
          </button>
        </div>

        {tab === "voices" ? (
          <VoiceManager
            voices={voices}
            models={models}
            loading={loading}
            t={t}
            onCreateVoiceFromReference={onCreateVoiceFromReference}
            onCreateVoiceFromDesignPrompt={onCreateVoiceFromDesignPrompt}
            onUpdateVoice={onUpdateVoice}
            onDeleteVoice={onDeleteVoice}
            onSelectVoiceReferenceAudio={onSelectVoiceReferenceAudio}
          />
        ) : (
          <>
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">{t("audioDashboard.runningTasks")}</h2>
            <span className="text-xs text-muted-foreground">
              {t("audioDashboard.runningTasksCount", { count: activeJobs.length })}
            </span>
          </div>
          {activeJobs.length ? (
            <div className="space-y-2">
              {activeJobs.map((job) => (
                <div key={job.id} className="rounded-md border bg-card p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{titleById.get(job.bookId) ?? job.bookId}</p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">{job.chapterHref}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <span className={cn("text-xs", job.status === "failed" ? "text-destructive" : "text-muted-foreground")}>
                        {t(`audio.jobStatus.${job.status}`)}
                      </span>
                      <button
                        className="inline-flex h-8 items-center gap-1.5 rounded-md border bg-background px-2.5 text-xs"
                        onClick={() => onCancelJob(job.id)}
                      >
                        <Square className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        <span>{t("audioDashboard.stop")}</span>
                      </button>
                    </div>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full bg-primary" style={{ width: `${Math.round(job.progress * 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon={CircleSlash} message={t("audioDashboard.runningTasksEmpty")} />
          )}
        </section>

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
