/** Project names as the user types them. */

export const MAX_NAME_LENGTH = 120

/** A project name as typed, or null if there's nothing left once trimmed. */
export function cleanName(raw: string): string | null {
  const name = raw.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH)
  return name ? name : null
}

/** The name for making a pattern again: "Toadstool (2)", or the next number not in
 *  `taken`. A copy of "Toadstool (2)" is "Toadstool (3)", not "Toadstool (2) (2)". */
export function againName(name: string, taken: Iterable<string>): string {
  const names = new Set(taken)
  const base = name.replace(/ \(\d+\)$/, '')
  for (let n = 2; ; n++) {
    const suffix = ` (${n})`
    const next = base.slice(0, MAX_NAME_LENGTH - suffix.length) + suffix
    if (!names.has(next)) return next
  }
}
