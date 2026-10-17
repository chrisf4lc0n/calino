import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createLocalStorageMock } from '@/test/storageMock'
import { resetConfigCache } from '@/lib/configLoader'
import { useConfigStore } from '../configStore'

interface GeneratorInput {
  accounts: Array<{
    name: string
    url: string
    username: string
    password: string
    headers?: Record<string, string>
    calendars?: Array<{ url: string; name: string }>
  }>
  webcals: Array<{ name: string; url: string; refreshIntervalMinutes?: number }>
}

/**
 * Run the generator's buildConfig in a real Node process, as users do. The
 * built-in is fetched at runtime because the test bundle polyfills node:*
 * imports (and `process` itself) for the browser.
 */
function generate(input: GeneratorInput, master: string): Record<string, unknown> {
  const nodeProcess = globalThis.process
  const { execFileSync } = nodeProcess.getBuiltinModule('node:child_process')
  // Vitest runs from the repo root; -e resolves relative imports from cwd.
  const code = `
    import { buildConfig } from './scripts/calino-config.mjs'
    const { input, master } = JSON.parse(process.env.GENERATOR_ARGS)
    process.stdout.write(JSON.stringify(await buildConfig(input, master)))
  `
  const stdout = execFileSync(nodeProcess.execPath, ['--input-type=module', '-e', code], {
    env: { ...nodeProcess.env, GENERATOR_ARGS: JSON.stringify({ input, master }) },
    encoding: 'utf8',
  })
  return JSON.parse(stdout)
}

const storage = createLocalStorageMock()
const globals = globalThis as Record<string, unknown>

describe('scripts/calino-config.mjs output', () => {
  beforeEach(() => {
    storage.install()
    resetConfigCache()
  })
  afterEach(() => {
    delete globals.__CALINO_CONFIG__
    vi.restoreAllMocks()
    storage.reset()
  })

  it('unlocks in the app with the master password it was made with', async () => {
    globals.__CALINO_CONFIG__ = generate(
      {
        accounts: [
          {
            name: 'Home',
            url: 'https://dav.example.com/',
            username: 'alice',
            password: 's3cret',
            calendars: [{ url: 'https://dav.example.com/alice/work/', name: 'Work' }],
          },
          {
            name: 'Office',
            url: 'https://office.example.com/dav',
            username: 'bob',
            password: 'pw',
            headers: { 'X-Gateway-Token': 'tok' },
          },
        ],
        webcals: [
          { name: 'Holidays', url: 'https://example.com/h.ics', refreshIntervalMinutes: 1440 },
        ],
      },
      'master-password'
    )

    await useConfigStore.getState().loadConfigFile()
    expect(useConfigStore.getState().hasPreconfiguredAccounts).toBe(true)

    expect(await useConfigStore.getState().unlock('wrong-password')).toBe(false)
    expect(await useConfigStore.getState().unlock('master-password')).toBe(true)

    const [home, office] = useConfigStore.getState().decryptedCredentials
    expect(home).toMatchObject({
      url: 'https://dav.example.com/',
      username: 'alice',
      password: 's3cret',
      calendars: [{ url: 'https://dav.example.com/alice/work/', name: 'Work' }],
    })
    expect(office.calendars).toBeUndefined()
    expect(office.customHeaders).toEqual({ 'X-Gateway-Token': 'tok' })
    expect(useConfigStore.getState().decryptedWebcalSubscriptions).toEqual([
      {
        name: 'Holidays',
        url: 'https://example.com/h.ics',
        refreshIntervalMinutes: 1440,
        proxyUrl: undefined,
      },
    ])
  }, 120_000)
})
