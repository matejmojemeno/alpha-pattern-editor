// @vitest-environment jsdom
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { DEFAULT_SETTINGS, SETTINGS_KEY, createSettingsStore } from '../../src/settings/store.ts'
import { memoryStorage, renderApp, screen } from './helpers.tsx'

describe('Settings screen', () => {
  it('shows the three preferences with their defaults', async () => {
    await renderApp('#/settings')
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeTruthy()
    const emphasise = screen.getByRole('switch', { name: 'Emphasise the rows around the current one' })
    const contrast = screen.getByRole('switch', { name: 'High contrast' })
    const focus = screen.getByRole('switch', { name: 'Focus mode' })
    expect([emphasise, contrast, focus].map((s) => (s as HTMLInputElement).checked)).toEqual([true, false, false])
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

  it('stores the other two and reads them back', async () => {
    const storage = memoryStorage()
    const settings = createSettingsStore(() => storage)
    await renderApp('#/settings', { settings })
    await userEvent.click(screen.getByRole('switch', { name: 'Focus mode' }))
    await userEvent.click(screen.getByRole('switch', { name: 'Emphasise the rows around the current one' }))
    expect(createSettingsStore(() => storage).get()).toEqual({
      ...DEFAULT_SETTINGS,
      emphasiseRows: false,
      highContrast: false,
      focusMode: true,
    })
  })

  it('applies a stored high-contrast setting on load, on any screen', async () => {
    const storage = memoryStorage()
    storage.setItem(SETTINGS_KEY, '{"highContrast":true}')
    await renderApp('#/library', { settings: createSettingsStore(() => storage) })
    expect(document.documentElement.dataset.contrast).toBe('high')
  })
})
