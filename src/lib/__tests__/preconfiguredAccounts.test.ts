import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createLocalStorageMock } from '@/test/storageMock'
import {
  calendarPath,
  filterSelectedCalendars,
  preconfiguredSecretHash,
  readPreconfiguredRegistry,
  sameCalendarSelection,
  writePreconfiguredRegistry,
} from '../preconfiguredAccounts'

const calendars = [
  { name: 'Personal', url: 'https://dav.example.com/calendars/me/personal/' },
  { name: 'Work', url: 'https://dav.example.com/calendars/me/work/' },
  { name: 'Calino Settings', url: 'https://dav.example.com/calendars/me/calino-settings/' },
]

const storage = createLocalStorageMock()

describe('preconfiguredAccounts', () => {
  beforeEach(() => storage.install())
  afterEach(() => {
    vi.restoreAllMocks()
    storage.reset()
  })

  it('normalizes absolute and relative collection URLs to one path', () => {
    expect(calendarPath('https://a.example/cal/My%20Cal/')).toBe('/cal/My Cal')
    expect(calendarPath('/cal/My Cal')).toBe('/cal/My Cal')
  })

  it('keeps every calendar without a selection', () => {
    expect(filterSelectedCalendars(calendars, undefined, undefined)).toHaveLength(3)
  })

  it('keeps only selected calendars plus the settings calendar', () => {
    const kept = filterSelectedCalendars(calendars, undefined, [
      { name: 'Work', url: '/calendars/me/work' },
    ])
    expect(kept.map((c) => c.name)).toEqual(['Work', 'Calino Settings'])
  })

  it('falls back to the name when a selected URL is no longer listed', () => {
    const kept = filterSelectedCalendars(calendars, undefined, [
      { name: 'Personal', url: 'https://dav.example.com/old/path/' },
    ])
    expect(kept.map((c) => c.name)).toEqual(['Personal', 'Calino Settings'])
  })

  it('reads the selection from the registry by account id', () => {
    writePreconfiguredRegistry({
      acc1: {
        configUrl: 'https://dav.example.com',
        username: 'me',
        secretHash: 'x',
        calendars: [{ name: 'Personal', url: '/calendars/me/personal/' }],
      },
    })
    expect(readPreconfiguredRegistry().acc1.username).toBe('me')
    expect(filterSelectedCalendars(calendars, 'acc1').map((c) => c.name)).toEqual([
      'Personal',
      'Calino Settings',
    ])
    expect(filterSelectedCalendars(calendars, 'other')).toHaveLength(3)
  })

  it('compares selections regardless of order and URL form', () => {
    const a = [
      { name: 'A', url: 'https://x/a/' },
      { name: 'B', url: 'https://x/b/' },
    ]
    const b = [
      { name: 'B', url: '/b' },
      { name: 'A', url: '/a' },
    ]
    expect(sameCalendarSelection(a, b)).toBe(true)
    expect(sameCalendarSelection(a, undefined)).toBe(false)
    expect(sameCalendarSelection(undefined, undefined)).toBe(true)
  })

  it('changes the secret hash when the password changes', async () => {
    const one = await preconfiguredSecretHash({ name: 'n', password: 'p1' })
    const two = await preconfiguredSecretHash({ name: 'n', password: 'p2' })
    expect(one).not.toBe(two)
    expect(one).toBe(await preconfiguredSecretHash({ name: 'n', password: 'p1' }))
  })
})
