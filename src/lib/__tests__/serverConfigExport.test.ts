import { describe, it, expect } from 'vitest'

// Each value goes through PBKDF2 with 600,000 iterations, which is slow on a
// busy machine; these tests encrypt and decrypt a dozen of them.
const CRYPTO_TIMEOUT_MS = 30_000
import { decryptWithMasterPassword, encryptWithMasterPassword } from '../crypto'
import type { CalinoConfig } from '../configLoader'
import {
  accountsToAdd,
  buildServerConfig,
  extraConfigFields,
  webcalsToAdd,
} from '../serverConfigExport'

const MASTER = 'correct horse battery'

describe('accountsToAdd', () => {
  const account = (id: string, serverUrl: string, username: string) => ({ id, serverUrl, username })

  it('skips accounts the config already provides', () => {
    const accounts = [
      account('tracked', 'https://davis.example.org/dav', 'chris'),
      account('same-login', 'https://cloud.example.org/remote.php/dav', 'chris'),
      account('new', 'https://radicale.example.org', 'chris'),
    ]
    const picked = accountsToAdd(accounts, new Set(['tracked']), [
      { url: 'https://cloud.example.org/remote.php/dav/', username: 'chris' },
    ])
    expect(picked.map((a) => a.id)).toEqual(['new'])
  })

  it('adds one copy of a login stored twice', () => {
    const picked = accountsToAdd(
      [
        account('a', 'https://davis.example.org/dav', 'chris'),
        account('b', 'https://davis.example.org/dav/', 'chris'),
        account('c', 'https://davis.example.org/dav', 'family'),
      ],
      new Set(),
      []
    )
    expect(picked.map((a) => a.id)).toEqual(['a', 'c'])
  })
})

describe('webcalsToAdd', () => {
  it('skips preconfigured feeds and ones the config lists', () => {
    const picked = webcalsToAdd(
      [
        { url: 'https://example.org/a.ics', isPreconfigured: true },
        { url: 'https://example.org/b.ics' },
        { url: 'https://example.org/c.ics' },
        { url: 'https://example.org/c.ics' },
      ],
      ['https://example.org/b.ics']
    )
    expect(picked.map((w) => w.url)).toEqual(['https://example.org/c.ics'])
  })
})

describe('extraConfigFields', () => {
  it('keeps fields the app does not manage, such as linkSchemes', () => {
    expect(
      extraConfigFields({
        version: 1,
        accounts: [],
        webcalSubscriptions: [],
        linkSchemes: { obsidian: 'Obsidian' },
      })
    ).toEqual({ linkSchemes: { obsidian: 'Obsidian' } })
    expect(extraConfigFields(null)).toEqual({})
    expect(extraConfigFields([1, 2])).toEqual({})
  })
})

describe('buildServerConfig', () => {
  it(
    'keeps existing entries verbatim and appends encrypted additions',
    async () => {
      const existing: CalinoConfig = {
        version: 1,
        accounts: [
          {
            name: 'Davis',
            url: await encryptWithMasterPassword('https://davis.example.org/dav/', MASTER),
            username: await encryptWithMasterPassword('chris', MASTER),
            password: await encryptWithMasterPassword('secret', MASTER),
            calendars: await encryptWithMasterPassword('[]', MASTER),
          },
        ],
        webcalSubscriptions: [],
      }

      const result = await buildServerConfig(
        {
          existing,
          extra: { linkSchemes: { obsidian: 'Obsidian' } },
          accounts: [
            {
              name: 'Radicale',
              url: 'https://radicale.example.org',
              username: 'chris',
              password: 'radicale-pass',
              headers: { 'P-Access-Token': 'tok' },
            },
          ],
          webcals: [
            { name: 'Holidays', url: 'https://example.org/h.ics', refreshIntervalMinutes: 1440 },
          ],
        },
        MASTER
      )

      expect(result.version).toBe(1)
      expect(result.linkSchemes).toEqual({ obsidian: 'Obsidian' })
      const accounts = result.accounts as CalinoConfig['accounts']
      expect(accounts[0]).toBe(existing.accounts[0])
      expect(accounts[1].name).toBe('Radicale')
      expect(await decryptWithMasterPassword(accounts[1].url, MASTER)).toBe(
        'https://radicale.example.org'
      )
      expect(await decryptWithMasterPassword(accounts[1].password, MASTER)).toBe('radicale-pass')
      expect(await decryptWithMasterPassword(accounts[1].headers!['P-Access-Token'], MASTER)).toBe(
        'tok'
      )
      expect(accounts[1].calendars).toBeUndefined()

      const webcals = result.webcalSubscriptions as CalinoConfig['webcalSubscriptions']
      expect(webcals).toHaveLength(1)
      expect(webcals[0].refreshIntervalMinutes).toBe(1440)
      expect(await decryptWithMasterPassword(webcals[0].url, MASTER)).toBe(
        'https://example.org/h.ics'
      )
    },
    CRYPTO_TIMEOUT_MS
  )

  it(
    'builds a config from scratch when there is none',
    async () => {
      const result = await buildServerConfig(
        {
          existing: null,
          accounts: [{ name: 'A', url: 'https://a.example.org', username: 'u', password: 'p' }],
          webcals: [],
        },
        MASTER
      )
      expect(result).toMatchObject({ version: 1, webcalSubscriptions: [] })
      expect((result.accounts as unknown[]).length).toBe(1)
    },
    CRYPTO_TIMEOUT_MS
  )
})

/**
 * Open the downloaded config with the generator's own decrypt, in a real Node
 * process, so `scripts/calino-config.mjs` can edit a file made in the browser.
 */
function decryptWithGenerator(value: unknown, master: string): string {
  const nodeProcess = globalThis.process
  const { execFileSync } = nodeProcess.getBuiltinModule('node:child_process')
  const code = `
    import { decryptValue } from './scripts/calino-config.mjs'
    const { value, master } = JSON.parse(process.env.GENERATOR_ARGS)
    process.stdout.write(await decryptValue(value, master))
  `
  return execFileSync(nodeProcess.execPath, ['--input-type=module', '-e', code], {
    env: { ...nodeProcess.env, GENERATOR_ARGS: JSON.stringify({ value, master }) },
    encoding: 'utf8',
  })
}

describe('a config made in the browser', () => {
  it(
    'opens in scripts/calino-config.mjs',
    async () => {
      const result = await buildServerConfig(
        {
          existing: null,
          accounts: [
            { name: 'A', url: 'https://a.example.org/dav', username: 'chris', password: 'p@ss' },
          ],
          webcals: [{ name: 'H', url: 'https://example.org/h.ics' }],
        },
        MASTER
      )
      const [account] = result.accounts as CalinoConfig['accounts']
      const [webcal] = result.webcalSubscriptions as CalinoConfig['webcalSubscriptions']
      expect(decryptWithGenerator(account.url, MASTER)).toBe('https://a.example.org/dav')
      expect(decryptWithGenerator(account.password, MASTER)).toBe('p@ss')
      expect(decryptWithGenerator(webcal.url, MASTER)).toBe('https://example.org/h.ics')
    },
    CRYPTO_TIMEOUT_MS
  )
})
