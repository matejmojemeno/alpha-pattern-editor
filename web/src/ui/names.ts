/** Project names as the user types them. */

export const MAX_NAME_LENGTH = 120

/** A project name as typed, or null if there's nothing left once trimmed. */
export function cleanName(raw: string): string | null {
  const name = raw.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH)
  return name ? name : null
}
