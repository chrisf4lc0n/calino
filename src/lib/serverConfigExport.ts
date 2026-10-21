/**
 * Build a calino.config.json for the server from what this browser has.
 *
 * Accounts and calendar feeds added in the browser normally live only here.
 * This turns them into a config the server can serve, so every browser gets
 * them: the entries of the current config are kept exactly as they are (same
 * encryption, same calendar selection), and the browser's additions are
 * encrypted with the same master password and appended. Without a config the
 * user chooses a master password and everything comes from the browser.
 *
 * The output has the same shape as scripts/calino-config.mjs writes, so the
 * generator can open and edit it afterwards.
 */

import { encryptWithMasterPassword } from './crypto'
import type { CalinoConfig } from './configLoader'
import { isSameLogin } from './preconfiguredAccounts'

export interface PlainAccount {
  name: string
  url: string
  username: string
  password: string
  headers?: Record<string, string>
}

export interface PlainWebcal {
  name: string
  url: string
  refreshIntervalMinutes?: number
  proxyUrl?: string | null
}

/** Top-level keys the app reads itself; anything else is carried over as is. */
const MANAGED_KEYS = new Set(['version', 'accounts', 'webcalSubscriptions'])

/**
 * Fields of the served config this app doesn't use, such as `linkSchemes`,
 * so a downloaded config doesn't drop them. Empty when there is no file.
 */
export function extraConfigFields(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  return Object.fromEntries(Object.entries(raw).filter(([key]) => !MANAGED_KEYS.has(key)))
}

/**
 * The browser's accounts that the config doesn't have yet: not connected from
 * the config (`trackedIds`), not the same login as a config entry, and not a
 * second copy of a login already picked.
 */
export function accountsToAdd<T extends { id: string; serverUrl: string; username: string }>(
  accounts: T[],
  trackedIds: Set<string>,
  configLogins: Array<{ url: string; username: string }>
): T[] {
  const picked: T[] = []
  for (const account of accounts) {
    if (trackedIds.has(account.id)) continue
    if (configLogins.some((c) => isSameLogin(account, c.url, c.username))) continue
    if (picked.some((p) => isSameLogin(account, p.serverUrl, p.username))) continue
    picked.push(account)
  }
  return picked
}

/** The browser's own calendar feeds that the config doesn't list yet. */
export function webcalsToAdd<T extends { url: string; isPreconfigured?: boolean }>(
  subscriptions: T[],
  configUrls: string[]
): T[] {
  const known = new Set(configUrls)
  const picked: T[] = []
  for (const subscription of subscriptions) {
    if (subscription.isPreconfigured || known.has(subscription.url)) continue
    known.add(subscription.url)
    picked.push(subscription)
  }
  return picked
}

export async function buildServerConfig(
  input: {
    /** The config being served now, already encrypted with `masterPassword`. */
    existing: CalinoConfig | null
    extra?: Record<string, unknown>
    accounts: PlainAccount[]
    webcals: PlainWebcal[]
  },
  masterPassword: string
): Promise<Record<string, unknown>> {
  const encrypt = (value: string) => encryptWithMasterPassword(value, masterPassword)

  const addedAccounts = []
  for (const account of input.accounts) {
    const headers: Record<string, Awaited<ReturnType<typeof encrypt>>> = {}
    for (const [name, value] of Object.entries(account.headers ?? {})) {
      headers[name] = await encrypt(value)
    }
    addedAccounts.push({
      name: account.name,
      url: await encrypt(account.url),
      username: await encrypt(account.username),
      password: await encrypt(account.password),
      ...(Object.keys(headers).length ? { headers } : {}),
    })
  }

  const addedWebcals = []
  for (const webcal of input.webcals) {
    addedWebcals.push({
      name: webcal.name,
      url: await encrypt(webcal.url),
      ...(webcal.refreshIntervalMinutes
        ? { refreshIntervalMinutes: webcal.refreshIntervalMinutes }
        : {}),
      ...(webcal.proxyUrl ? { proxyUrl: webcal.proxyUrl } : {}),
    })
  }

  return {
    ...input.extra,
    version: 1,
    accounts: [...(input.existing?.accounts ?? []), ...addedAccounts],
    webcalSubscriptions: [...(input.existing?.webcalSubscriptions ?? []), ...addedWebcals],
  }
}
