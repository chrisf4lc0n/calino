/**
 * Runtime calino.config.json (made by scripts/calino-config.mjs): the app reads
 * it on every load, connects only the calendars it selects, and follows the
 * file when it is regenerated — no rebuild.
 *
 * The file is served through page.route; a deployed image serves it from a
 * bind mount (see docs/PORTAINER.md).
 */
import { execFileSync } from 'node:child_process'
import { test, expect, type Page } from '@playwright/test'
import { clearState } from './fixtures/localstorage'

const MASTER = 'e2e-master-password'

interface Account {
  name: string
  url: string
  username: string
  password: string
  calendars?: Array<{ url: string; name: string }>
}

/** Encrypt a config with the real generator, in Node, as a user would. */
function generateConfig(accounts: Account[], webcals: Array<{ name: string; url: string }> = []) {
  const code = `
    import { buildConfig } from './scripts/calino-config.mjs'
    const { accounts, webcals, master } = JSON.parse(process.env.GENERATOR_ARGS)
    process.stdout.write(JSON.stringify(await buildConfig({ accounts, webcals }, master)))
  `
  const stdout = execFileSync(process.execPath, ['--input-type=module', '-e', code], {
    env: { ...process.env, GENERATOR_ARGS: JSON.stringify({ accounts, webcals, master: MASTER }) },
    encoding: 'utf8',
  })
  return JSON.parse(stdout) as Record<string, unknown>
}

/** Serve `current.config` as /calino.config.json; swap it to "regenerate". */
async function serveConfig(page: Page, current: { config: Record<string, unknown> }) {
  await page.route('**/calino.config.json', (route) =>
    route.fulfill({ json: current.config, headers: { 'Cache-Control': 'no-store' } })
  )
}

async function unlock(page: Page) {
  const prompt = page.getByRole('dialog')
  await expect(prompt.locator('input[type="password"]')).toBeVisible({ timeout: 15_000 })
  await prompt.locator('input[type="password"]').fill(MASTER)
  await prompt.locator('input[type="password"]').press('Enter')
  await expect(prompt).toBeHidden({ timeout: 15_000 })
}

async function openCalendarList(page: Page) {
  const toggle = page.locator('[data-component="calendar-section-toggle"]')
  await expect(toggle).toBeVisible({ timeout: 15_000 })
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click()
}

test.describe('Runtime config — generated calino.config.json', () => {
  test.beforeEach(async ({ page }) => {
    await clearState(page)
  })

  test('syncs only the selected calendars and follows a regenerated config', async ({
    page,
    baseURL,
  }) => {
    const account: Account = {
      name: 'Mock DAV',
      url: `${baseURL}/mock-caldav/`,
      username: 'user',
      password: 'pass',
      calendars: [{ url: `${baseURL}/mock-caldav/dav/calendars/user/work/`, name: 'Work' }],
    }
    const current = { config: generateConfig([account]) }
    await serveConfig(page, current)

    await page.goto('/')
    await unlock(page)
    await openCalendarList(page)
    await expect(page.getByText('Work', { exact: true })).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText('Birthdays', { exact: true })).toHaveCount(0)

    // Regenerated to sync every calendar: the next load adds the rest.
    current.config = generateConfig([{ ...account, calendars: undefined }])
    await page.reload()
    await openCalendarList(page)
    await expect(page.getByText('Birthdays', { exact: true })).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText('Work', { exact: true })).toBeVisible()

    // Back to Work only: the others are dropped again.
    current.config = generateConfig([account])
    await page.reload()
    await openCalendarList(page)
    await expect(page.getByText('Birthdays', { exact: true })).toHaveCount(0, { timeout: 20_000 })
    await expect(page.getByText('Work', { exact: true })).toBeVisible()
  })

  test('connects without crypto.subtle (plain HTTP on a LAN address)', async ({
    page,
    baseURL,
  }) => {
    // Browsers hide SubtleCrypto outside secure contexts, e.g. a self-hosted
    // instance opened as http://192.168.x.x:8080.
    await page.addInitScript(() => {
      Object.defineProperty(globalThis.crypto, 'subtle', {
        configurable: true,
        value: undefined,
      })
    })
    const account: Account = {
      name: 'Insecure DAV',
      url: `${baseURL}/mock-caldav/`,
      username: 'user',
      password: 'pass',
    }
    await serveConfig(page, { config: generateConfig([account]) })

    await page.goto('/')
    await unlock(page)
    await openCalendarList(page)
    await expect(page.getByText('Work', { exact: true })).toBeVisible({ timeout: 30_000 })
  })

  test('removes an account that is no longer in the config', async ({ page, baseURL }) => {
    const account: Account = {
      name: 'Second DAV',
      url: `${baseURL}/mock-caldav-b/`,
      username: 'userb',
      password: 'pass',
    }
    const current = { config: generateConfig([account]) }
    await serveConfig(page, current)

    await page.goto('/')
    await unlock(page)
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('calino_caldav_accounts') ?? ''), {
        timeout: 20_000,
      })
      .toContain('Second DAV')

    // A config that keeps only a feed: the account goes, no prompt needed.
    current.config = generateConfig([], [{ name: 'Feed', url: `${baseURL}/missing-feed.ics` }])
    await page.reload()
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('calino_caldav_accounts') ?? ''), {
        timeout: 20_000,
      })
      .not.toContain('Second DAV')
  })
})
