// @vitest-environment jsdom
import userEvent from '@testing-library/user-event'
import { within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { APP_COMMIT, APP_VERSION } from '../../src/app/build.ts'
import { DEFAULT_SETTINGS, SETTINGS_KEY, createSettingsStore } from '../../src/settings/store.ts'
import { memoryStorage, renderApp, screen } from './helpers.tsx'

describe('Settings screen', () => {
  it('shows the five Work chart switches, in the order Options has them, with their defaults', async () => {
    await renderApp('#/settings')
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 2, name: 'Work chart' })).toBeTruthy()
    const switches = screen.getAllByRole<HTMLInputElement>('switch')
    expect(switches.map((s) => [s.labels![0]!.textContent, s.checked])).toEqual([
      ['Number the stitches', true],
      ['Show the colours in this row', true],
      ['Show where to carry yarn', false],
      ['Enlarge the current row', true],
      ['Focus mode', false],
    ])
    expect(screen.queryByText(/contrast/i)).toBeNull()
  })

  it('says which version and build this is, with links to what changed and to help', async () => {
    await renderApp('#/settings')
    const about = screen.getByRole('region', { name: 'About' })
    expect(about.textContent).toContain(`version ${APP_VERSION}`)
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
    // Tests run in a git checkout, so the build knows its commit.
    expect(APP_COMMIT).toMatch(/^[0-9a-f]{7}$/)
    expect(within(about).getByRole('link', { name: APP_COMMIT }).getAttribute('href')).toBe(
      `https://github.com/matejmojemeno/alpha-pattern-editor/commit/${APP_COMMIT}`,
    )
    expect(within(about).getByRole('link', { name: 'What’s new' }).getAttribute('href')).toBe(
      'https://github.com/matejmojemeno/alpha-pattern-editor/blob/main/CHANGELOG.md',
    )
    expect(
      screen.getByRole('link', { name: 'Help with Settings (opens in a new tab)' }).getAttribute('href'),
    ).toBe('https://github.com/matejmojemeno/alpha-pattern-editor/blob/main/docs/guide/settings.md')
  })

  it('stores each switch and reads it back', async () => {
    const storage = memoryStorage()
    const settings = createSettingsStore(() => storage)
    await renderApp('#/settings', { settings })
    await userEvent.click(screen.getByRole('switch', { name: 'Focus mode' }))
    await userEvent.click(screen.getByRole('switch', { name: 'Show where to carry yarn' }))
    await userEvent.click(screen.getByRole('switch', { name: 'Number the stitches' }))
    await userEvent.click(screen.getByRole('switch', { name: 'Enlarge the current row' }))
    await userEvent.click(screen.getByRole('switch', { name: 'Show the colours in this row' }))
    expect(createSettingsStore(() => storage).get()).toEqual({
      ...DEFAULT_SETTINGS,
      emphasiseRows: false,
      showRowColours: false,
      focusMode: true,
      showCarries: true,
      stitchNumbers: false,
    })
  })

  it('ignores high contrast stored by an earlier version, which is gone', async () => {
    const storage = memoryStorage()
    storage.setItem(SETTINGS_KEY, '{"highContrast":true,"focusMode":true}')
    const settings = createSettingsStore(() => storage)
    await renderApp('#/settings', { settings })
    expect(document.documentElement.dataset.contrast).toBeUndefined()
    expect(settings.get()).toEqual({ ...DEFAULT_SETTINGS, focusMode: true })
    // The next change writes the settings without it.
    await userEvent.click(screen.getByRole('switch', { name: 'Show where to carry yarn' }))
    expect(JSON.parse(storage.getItem(SETTINGS_KEY)!)).not.toHaveProperty('highContrast')
  })
})
