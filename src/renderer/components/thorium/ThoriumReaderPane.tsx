import { useMemo, type ReactElement } from "react"
import { Locator } from "@readium/shared"
import {
  StatefulGlobalPreferencesProvider,
  StatefulReaderWrapper,
  ThStoreProvider,
  usePublication,
  type PositionStorage
} from "@edrlab/thorium-web/reader"
import type { TranslationFn } from "@renderer/app/types"
import { dreamreaderClient } from "@renderer/lib/dreamreader"
import { installReadiumEpubNavigationPatch, serializeReadiumLocator } from "@renderer/lib/readium-compat"
import type { BookDetails, Locale } from "@renderer/types"

const thoriumI18nLoadPath = "./locales/{{lng}}/{{ns}}.json"
const thoriumReaderStorageKey = "dreamreader.thorium.reader"

installReadiumEpubNavigationPatch()

type ThoriumReaderPaneProps = {
  book: BookDetails | null
  locale: Locale
  t: TranslationFn
}

export function ThoriumReaderPane({ book, locale, t }: ThoriumReaderPaneProps): ReactElement {
  if (!book) {
    return (
      <section className="flex h-full items-center justify-center bg-background px-6">
        <div className="max-w-md text-center">
          <h2 className="text-lg font-semibold">{t("reader.noBook")}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{t("reader.noBookBody")}</p>
        </div>
      </section>
    )
  }

  return (
    <ThStoreProvider storageKey={thoriumReaderStorageKey}>
      <StatefulGlobalPreferencesProvider initialPreferences={{ locale }}>
        <ThoriumPublicationReader book={book} locale={locale} t={t} />
      </StatefulGlobalPreferencesProvider>
    </ThStoreProvider>
  )
}

function ThoriumPublicationReader({ book, locale, t }: { book: BookDetails; locale: Locale; t: TranslationFn }): ReactElement {
  const manifestUrl = useMemo(() => publicationManifestUrl(book.id), [book.id])
  const { error, isLoading, localDataKey, profile, publication } = usePublication({ url: manifestUrl })
  const positionStorage = useMemo<PositionStorage>(
    () => ({
      get: () => {
        if (!book.lastPosition?.readiumLocator) {
          return undefined
        }
        return Locator.deserialize(book.lastPosition.readiumLocator)
      },
      set: (locator) => {
        const serialized = serializeReadiumLocator(locator)
        return dreamreaderClient.saveReadiumLocator(book.id, serialized)
      }
    }),
    [book.id, book.lastPosition?.readiumLocator]
  )

  if (error) {
    return (
      <section className="flex h-full items-center justify-center bg-background px-6">
        <div className="max-w-md rounded-md border bg-card p-5 text-sm shadow-sm">
          <h2 className="text-base font-semibold">{t("common.error")}</h2>
          <p className="mt-2 text-muted-foreground">{error.context ?? t("common.error")}</p>
        </div>
      </section>
    )
  }

  if (!publication || !profile) {
    return (
      <section className="flex h-full items-center justify-center bg-background px-6">
        <p className="text-sm text-muted-foreground">{t(isLoading ? "common.loading" : "reader.noBook")}</p>
      </section>
    )
  }

  return (
    <section className="h-full min-h-0 overflow-hidden bg-background">
      <StatefulReaderWrapper
        profile={profile}
        publication={publication}
        localDataKey={localDataKey}
        isLoading={isLoading}
        positionStorage={positionStorage}
        i18n={{ lng: locale, fallbackLng: "en", backend: { loadPath: thoriumI18nLoadPath } }}
      />
    </section>
  )
}

function publicationManifestUrl(bookId: string): string {
  return `dreamreader://publication/${encodeURIComponent(bookId)}/manifest.json`
}
