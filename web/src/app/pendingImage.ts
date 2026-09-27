/**
 * The image chosen on the landing screen or in the Library, handed to the import screen.
 * It lives in memory only: after a reload, #/import simply asks for an image.
 */
import type { Notice } from '../ui/useAlphaImport.ts'

export interface PendingImage {
  file: Blob
  /** The name it gets if none is typed, shown greyed in the empty name field: the file
   *  name without its extension, or, for a pasted image, the date (`pastedName`). */
  name: string
  /** Anything to tell the user on arrival, such as "only the first image was opened". */
  notices?: Notice[]
}

let pending: PendingImage | null = null

export function handOffImage(image: PendingImage): void {
  pending = image
}

/** The waiting image, if any. Reading doesn't clear it (React may render twice); leaving
 *  the import screen does. */
export function pendingImage(): PendingImage | null {
  return pending
}

export function clearPendingImage(): void {
  pending = null
}

/** A project name from a file name: its extension dropped. */
export function nameFromFile(fileName: string): string {
  const base = fileName.replace(/\.[^./\\]+$/, '').trim()
  return base || 'Imported pattern'
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** A pasted image's name, "Pattern 27 Sep 2026, 14:05": a pasted image has no file name
 *  worth keeping, and the time tells two pasted the same day apart. Spelled out rather
 *  than left to the locale, so it reads the same everywhere. */
export function pastedName(now = new Date()): string {
  const hh = String(now.getHours()).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  return `Pattern ${now.getDate()} ${MONTHS[now.getMonth()]} ${now.getFullYear()}, ${hh}:${mm}`
}
