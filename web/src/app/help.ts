/**
 * Every link from the app to the user guide (docs/guide/), in one place, so moving the
 * guide means changing GUIDE_BASE and nothing else. The guide is read on GitHub until it
 * is built into the app's own website.
 *
 * tests/docs.test.ts checks that every page and anchor here exists in docs/guide/.
 */

export const REPO_URL = 'https://github.com/matejmojemeno/alpha-pattern-editor'

/** Where the guide's Markdown pages are read from. */
export const GUIDE_BASE = `${REPO_URL}/blob/main/docs/guide/`

/** "What's new": the changelog, newest first. */
export const CHANGELOG_URL = `${REPO_URL}/blob/main/CHANGELOG.md`

/** The guide page for each screen, with the anchor to land on, if any. */
export const HELP = {
  home: { page: 'index.md' },
  library: { page: 'library.md' },
  settings: { page: 'settings.md' },
  import: { page: 'import.md' },
  design: { page: 'design.md' },
  work: { page: 'work.md' },
  troubleshooting: { page: 'troubleshooting.md' },
} as const satisfies Record<string, { page: string; anchor?: string }>

export type HelpTopic = keyof typeof HELP

export function helpUrl(topic: HelpTopic): string {
  const { page, anchor } = HELP[topic] as { page: string; anchor?: string }
  return `${GUIDE_BASE}${page}${anchor ? `#${anchor}` : ''}`
}

/** The screen's name, for the link's accessible label ("Help with designing"). */
export const HELP_LABEL: Record<HelpTopic, string> = {
  home: 'getting started',
  library: 'the Library',
  settings: 'Settings',
  import: 'importing',
  design: 'designing',
  work: 'following a pattern',
  troubleshooting: 'problems',
}
