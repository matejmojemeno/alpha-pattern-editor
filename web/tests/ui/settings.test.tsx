// @vitest-environment jsdom
import userEvent from '@testing-library/user-event'
import { within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { APP_COMMIT, APP_VERSION } from '../../src/app/build.ts'
import { DEFAULT_SETTINGS, SETTINGS_KEY, createSettingsStore } from '../../src/settings/store.ts'
import { memoryStorage, renderApp, screen } from './helpers.tsx'

describe('Settings screen', () => {
  it('shows the four preferences with their defaults', async () => {
    await renderApp('#/settings')
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeTruthy()
    const emphasise = screen.getByRole('switch', { name: 'Emphasise the rows around the current one' })
    const contrast = screen.getByRole('switch', { name: 'High contrast' })
    const focus = screen.getByRole('switch', { name: 'Focus mode' })
    const carry = screen.getByRole('switch', { name: 'Show where to carry yarn' })
    expect([emphasise, contrast, focus, carry].map((s) => (s as HTMLInputElement).checked)).toEqual([true, false, false, false])
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

  it('applies high contrast app-wide as soon as it is switched', async () => {
    const { storage } = await renderApp('#/settings')
    expect(document.documentElement.dataset.contrast).toBeUndefined()
    await userEvent.click(screen.getByRole('switch', { name: 'High contrast' }))
    expect(document.documentElement.dataset.contrast).toBe('high')
    expect(JSON.parse(storage.getItem(SETTINGS_KEY)!).highContrast).toBe(true)
    await userEvent.click(screen.getByRole('switch', { name: 'High contrast' }))
    expect(document.documentElement.dataset.contrast).toBeUndefined()
  })

  it('stores the others and reads them back', async () => {
    const storage = memoryStorage()
    const settings = createSettingsStore(() => storage)
    await renderApp('#/settings', { settings })
    await userEvent.click(screen.getByRole('switch', { name: 'Focus mode' }))
    await userEvent.click(screen.getByRole('switch', { name: 'Show where to carry yarn' }))
    expect(screen.getByRole<HTMLInputElement>('switch', { name: 'Number the stitches' }).checked).toBe(true)
    await userEvent.click(screen.getByRole('switch', { name: 'Number the stitches' }))
    await userEvent.click(screen.getByRole('switch', { name: 'Emphasise the rows around the current one' }))
    expect(createSettingsStore(() => storage).get()).toEqual({
      ...DEFAULT_SETTINGS,
      emphasiseRows: false,
      highContrast: false,
      focusMode: true,
      showCarries: true,
      stitchNumbers: false,
    })
  })

  it('applies a stored high-contrast setting on load, on any screen', async () => {
    const storage = memoryStorage()
    storage.setItem(SETTINGS_KEY, '{"highContrast":true}')
    await renderApp('#/library', { settings: createSettingsStore(() => storage) })
    expect(document.documentElement.dataset.contrast).toBe('high')
  })
})
