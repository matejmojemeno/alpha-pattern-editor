/**
 * Importing `.alpha` files, shared by the landing screen and the Library.
 *
 * A file is parsed before anything is stored, so a damaged or newer-format file is
 * refused with a message and changes nothing. A project that is already in the Library
 * is not silently overwritten: the user is told, shown both progress figures, and asked.
 * Re-importing an old backup over a project with more progress would otherwise lose work.
 */
import { useCallback, useState } from 'react'

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

const IMAGE = /\.(png|jpe?g|gif|webp|heic|heif|bmp|tiff?)$/i

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

export function useAlphaImport(repo: ProjectRepo | null, onImported?: (ids: string[]) => void) {
  const [notices, setNotices] = useState<Notice[]>([])
  const [busy, setBusy] = useState(false)
  const [question, setQuestion] = useState<ReplaceQuestion | null>(null)

  const importFiles = useCallback(
    async (files: Iterable<File>) => {
      if (!repo) return
      const list = [...files]
      if (list.length === 0) return
      setBusy(true)
      const out: Notice[] = []
      const imported: string[] = []
      for (const file of list) {
        if (!/\.alpha$/i.test(file.name)) {
          out.push({
            tone: 'error',
            text: IMAGE.test(file.name)
              ? `“${file.name}” is an image. Importing a pattern from a photo arrives in a later version; for now, import a .alpha file.`
              : `“${file.name}” isn't a .alpha file.`,
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
          out.push({
            tone: 'ok',
            text: existing
              ? `“${name}” was already in your library. Replaced it with the imported copy (${pct(progressPct(project.pattern, project.progress))} done).`
              : `Imported “${name}”.`,
          })
        } catch (e) {
          out.push({ tone: 'error', text: describeError(file.name, e) })
        }
      }
      setNotices(out)
      setBusy(false)
      if (imported.length) onImported?.(imported)
    },
    [repo, onImported],
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
