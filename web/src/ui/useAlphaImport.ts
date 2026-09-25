/**
 * Importing files, shared by the landing screen and the Library.
 *
 * A chart image (PNG, JPEG or WebP) goes to the import screen, which detects the pattern
 * in it; one image at a time. `.alpha` files are imported here, as before.
 *
 * A file is parsed before anything is stored, so a damaged or newer-format file is
 * refused with a message and changes nothing. A project that is already in the Library
 * is not silently overwritten: the user is told, shown both progress figures, and asked.
 * Re-importing an old backup over a project with more progress would otherwise lose work.
 */
import { useCallback, useState } from 'react'

import { handOffImage, nameFromFile, type PendingImage } from '../app/pendingImage.ts'
import { navigate, paths } from '../app/router.ts'
import { AlphaFormatError, progressPct, readAlpha } from '../storage/alpha.ts'
import type { ProjectRepo } from '../storage/repo.ts'

export interface Notice {
  tone: 'ok' | 'info' | 'error'
  text: string
}

export interface ReplaceQuestion {
  name: string
  existingPct: number
  incomingPct: number
  answer: (replace: boolean) => void
}

/** Images the importer reads: every browser decodes these. */
const DETECTABLE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])
const DETECTABLE_EXT = /\.(png|jpe?g|webp)$/i
/** Other images, which get a clearer refusal than "not a .alpha file". */
const OTHER_IMAGE = /\.(gif|heic|heif|bmp|tiff?|avif)$/i

/** What the file pickers offer: projects and chart images. */
export const IMPORT_ACCEPT = '.alpha,.png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp'

export function isChartImage(file: File): boolean {
  return DETECTABLE_TYPES.has(file.type) || DETECTABLE_EXT.test(file.name)
}

/** Open an image on the import screen. */
export function openImageImport(image: PendingImage): void {
  handOffImage(image)
  navigate(paths.importImage)
}

async function readBytes(file: Blob): Promise<Uint8Array> {
  if (typeof file.arrayBuffer === 'function') return new Uint8Array(await file.arrayBuffer())
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer))
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(file)
  })
}

const pct = (n: number) => `${Math.round(n)}%`

export function useAlphaImport(
  repo: ProjectRepo | null,
  onImported?: (ids: string[]) => void,
  onImage: (image: PendingImage) => void = openImageImport,
) {
  const [notices, setNotices] = useState<Notice[]>([])
  const [busy, setBusy] = useState(false)
  const [question, setQuestion] = useState<ReplaceQuestion | null>(null)

  const importFiles = useCallback(
    async (files: Iterable<File>) => {
      if (!repo) return
      const all = [...files]
      if (all.length === 0) return
      const images = all.filter((f) => !/\.alpha$/i.test(f.name) && isChartImage(f))
      const list = all.filter((f) => !images.includes(f))
      setBusy(true)
      const out: Notice[] = []
      const imported: string[] = []
      const added: string[] = [] // names of projects that are new to the Library
      for (const file of list) {
        if (!/\.alpha$/i.test(file.name)) {
          out.push({
            tone: 'error',
            text: OTHER_IMAGE.test(file.name) || file.type.startsWith('image/')
              ? `“${file.name}” is an image the importer can't read. Use a PNG, JPEG or WebP image.`
              : `“${file.name}” isn't a .alpha file or a chart image.`,
          })
          continue
        }
        try {
          const bytes = await readBytes(file)
          const { project } = readAlpha(bytes)
          const { name, id } = project.pattern
          const existing = await repo.summary(id)
          if (existing) {
            const replace = await new Promise<boolean>((answer) =>
              setQuestion({
                name,
                existingPct: existing.progress_pct,
                incomingPct: progressPct(project.pattern, project.progress),
                answer,
              }),
            )
            setQuestion(null)
            if (!replace) {
              out.push({ tone: 'info', text: `“${name}” is already in your library. Kept the copy you had.` })
              continue
            }
          }
          await repo.importFile(bytes)
          imported.push(id)
          if (existing) {
            out.push({
              tone: 'ok',
              text: `“${name}” was already in your library. Replaced it with the imported copy (${pct(progressPct(project.pattern, project.progress))} done).`,
            })
          } else {
            added.push(name)
          }
        } catch (e) {
          out.push({ tone: 'error', text: describeError(file.name, e) })
        }
      }
      if (added.length) {
        out.unshift({
          tone: 'ok',
          text:
            added.length === 1
              ? `Imported “${added[0]}”.`
              : `Imported ${added.length} projects: ${added.map((n) => `“${n}”`).join(', ')}.`,
        })
      }
      setBusy(false)
      const image = images[0]
      if (image) {
        if (images.length > 1) {
          out.push({ tone: 'info', text: `One image at a time: opened “${image.name}”. Import the others after this one.` })
        }
        onImage({ file: image, name: nameFromFile(image.name), notices: out })
        return
      }
      setNotices(out)
      if (imported.length) onImported?.(imported)
    },
    [repo, onImported, onImage],
  )

  return { importFiles, notices, setNotices, busy, question }
}

function describeError(filename: string, e: unknown): string {
  if (e instanceof AlphaFormatError) {
    return e.code === 'NEWER_VERSION'
      ? `“${filename}” was saved by a newer version of Alpha Pattern Editor and can't be opened here.`
      : `“${filename}” couldn't be read as a pattern. It may be damaged. (${e.message})`
  }
  return `Couldn't import “${filename}”: ${e instanceof Error ? e.message : String(e)}`
}

export { pct as formatPct }
