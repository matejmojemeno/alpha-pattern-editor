/**
 * The image chosen on the landing screen or in the Library, handed to the import screen.
 * It lives in memory only: after a reload, #/import simply asks for an image.
 */
import type { Notice } from '../ui/useAlphaImport.ts'

export interface PendingImage {
  file: Blob
  /** The default project name: the file name without its extension, or "Pasted pattern". */
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

export const PASTED_NAME = 'Pasted pattern'
