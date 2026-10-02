/**
 * The image chosen on the landing screen or in the Library, handed to the import screen.
 * It lives in memory only: after a reload, #/import (or #/photo) simply asks for an image.
 */
import type { Notice } from '../ui/useAlphaImport.ts'

export interface PendingImage {
  file: Blob
  /** Anything to tell the user on arrival, such as "only the first image was opened". */
  notices?: Notice[]
  /** The pattern name typed so far, when moving from one import screen to the other. */
  name?: string
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

const pad = (n: number) => String(n).padStart(2, '0')

/** The name of a pattern saved without one: the moment it was saved, in local time,
 *  "2026-09-27-121530". Sorts by date, and two saved a second apart differ. */
export function timestampName(now = new Date()): string {
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  return `${date}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}
