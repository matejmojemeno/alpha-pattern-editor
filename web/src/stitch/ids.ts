/** The stitches "Visualize" knows, by id: all the settings store needs, kept apart from
 *  the catalogue so the main chunk doesn't carry it. */
export const STITCH_IDS = ['sc', 'sc-blo', 'sc-flo', 'hdc', 'dc', 'waistcoat', 'c2c'] as const

export type StitchId = (typeof STITCH_IDS)[number]

export function isStitchId(v: unknown): v is StitchId {
  return (STITCH_IDS as readonly unknown[]).includes(v)
}
