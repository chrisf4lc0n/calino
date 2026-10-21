import type { JSX } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getCredentialById } from '@/features/caldav/client/credentials'
import type { CalDAVAccount } from '@/features/caldav/types'
import type { WebcalSubscription } from '@/features/webcal/types'
import { readPreconfiguredRegistry } from '@/lib/preconfiguredAccounts'
import {
  accountsToAdd,
  buildServerConfig,
  extraConfigFields,
  webcalsToAdd,
  type PlainAccount,
} from '@/lib/serverConfigExport'
import { useConfigStore } from '@/store/configStore'
import styles from './Settings.module.css'

const MIN_MASTER_PASSWORD_LENGTH = 8

type Status = { kind: 'success' | 'error'; message: string } | null

/** The served config's raw JSON, for the fields this app doesn't read. */
async function fetchServedConfig(): Promise<unknown> {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}calino.config.json`, {
      cache: 'no-store',
      credentials: 'same-origin',
    })
    if (!response.ok || (response.headers.get('content-type') ?? '').includes('text/html')) {
      return null
    }
    return await response.json()
  } catch {
    return null
  }
}

function download(json: string): void {
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = 'calino.config.json'
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * Settings → Sync: download a calino.config.json that adds this browser's
 * accounts and calendar feeds to the server's config. Only shown in builds
 * that read a config from the server (self-hosted).
 */
export function ServerConfigExport({
  accounts,
  subscriptions,
}: {
  accounts: CalDAVAccount[]
  subscriptions: WebcalSubscription[]
}): JSX.Element | null {
  const { t } = useTranslation('settings')
  const config = useConfigStore((s) => s.config)
  const isUnlocked = useConfigStore((s) => s.isUnlocked)
  const masterPassword = useConfigStore((s) => s.masterPassword)
  const decryptedCredentials = useConfigStore((s) => s.decryptedCredentials)
  const decryptedWebcals = useConfigStore((s) => s.decryptedWebcalSubscriptions)

  const [choosingPassword, setChoosingPassword] = useState(false)
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<Status>(null)

  if (typeof __CALINO_RUNTIME_CONFIG__ === 'undefined' || !__CALINO_RUNTIME_CONFIG__) return null

  const hasConfig = Boolean(config)

  const exportConfig = async (master: string): Promise<void> => {
    setBusy(true)
    setStatus(null)
    try {
      const newAccounts = accountsToAdd(
        accounts,
        new Set(Object.keys(readPreconfiguredRegistry())),
        decryptedCredentials
      )
      const plainAccounts: PlainAccount[] = []
      for (const account of newAccounts) {
        const credential = await getCredentialById(account.credentialId)
        if (!credential) continue
        plainAccounts.push({
          name: account.name,
          url: account.serverUrl,
          username: account.username,
          password: credential.password,
          headers: credential.customHeaders,
        })
      }
      const newWebcals = webcalsToAdd(
        subscriptions,
        decryptedWebcals.map((w) => w.url)
      )

      const result = await buildServerConfig(
        {
          existing: config,
          extra: hasConfig ? extraConfigFields(await fetchServedConfig()) : {},
          accounts: plainAccounts,
          webcals: newWebcals,
        },
        master
      )
      const accountCount = (result.accounts as unknown[]).length
      const webcalCount = (result.webcalSubscriptions as unknown[]).length
      if (accountCount === 0 && webcalCount === 0) {
        setStatus({ kind: 'error', message: t('serverConfig.nothingToExport') })
        return
      }

      download(JSON.stringify(result, null, 2) + '\n')
      setStatus({
        kind: 'success',
        message: t('serverConfig.downloaded', {
          accounts: accountCount,
          newAccounts: plainAccounts.length,
          feeds: webcalCount,
          newFeeds: newWebcals.length,
        }),
      })
      setChoosingPassword(false)
      setPassword('')
      setRepeat('')
    } catch (error) {
      setStatus({
        kind: 'error',
        message: t('serverConfig.failed', {
          message: error instanceof Error ? error.message : String(error),
        }),
      })
    } finally {
      setBusy(false)
    }
  }

  const onDownload = (): void => {
    if (hasConfig) {
      if (!isUnlocked || !masterPassword) {
        setStatus({ kind: 'error', message: t('serverConfig.unlockFirst') })
        return
      }
      void exportConfig(masterPassword)
      return
    }
    setStatus(null)
    setChoosingPassword(true)
  }

  const onChosenPassword = (): void => {
    if (password.length < MIN_MASTER_PASSWORD_LENGTH) {
      setStatus({
        kind: 'error',
        message: t('serverConfig.tooShort', { min: MIN_MASTER_PASSWORD_LENGTH }),
      })
      return
    }
    if (password !== repeat) {
      setStatus({ kind: 'error', message: t('serverConfig.mismatch') })
      return
    }
    void exportConfig(password)
  }

  return (
    <div className={styles.group} data-component="server-config-export">
      <div className={styles.groupLabel}>{t('serverConfig.groupLabel')}</div>
      <div className={`${styles.actionRow} ${styles.actionRowStacked}`}>
        <div className={styles.rowInfo}>
          <div className={styles.rowLabel}>{t('serverConfig.label')}</div>
          <div className={styles.rowDesc}>
            {hasConfig ? t('serverConfig.descWithConfig') : t('serverConfig.descWithoutConfig')}
          </div>
        </div>
        {choosingPassword ? (
          <div className={`${styles.rowControl} ${styles.rowControlGroup}`}>
            <input
              className={styles.textInput}
              type="password"
              autoComplete="new-password"
              placeholder={t('serverConfig.passwordLabel')}
              aria-label={t('serverConfig.passwordLabel')}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              data-component="server-config-password"
            />
            <input
              className={styles.textInput}
              type="password"
              autoComplete="new-password"
              placeholder={t('serverConfig.repeatLabel')}
              aria-label={t('serverConfig.repeatLabel')}
              value={repeat}
              onChange={(e) => setRepeat(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onChosenPassword()
              }}
              data-component="server-config-password-repeat"
            />
            <button
              className={styles.actionBtn}
              onClick={onChosenPassword}
              disabled={busy}
              data-action="download-server-config-confirm"
              type="button"
            >
              {busy ? t('serverConfig.working') : t('serverConfig.button')}
            </button>
          </div>
        ) : (
          <button
            className={styles.actionBtn}
            onClick={onDownload}
            disabled={busy}
            data-action="download-server-config"
            type="button"
          >
            {busy ? t('serverConfig.working') : t('serverConfig.button')}
          </button>
        )}
      </div>
      {status && (
        <div
          className={`${styles.importStatus} ${
            status.kind === 'success' ? styles.importStatusSuccess : styles.importStatusError
          }`}
          role="status"
          data-component="server-config-status"
          data-status={status.kind}
        >
          {status.message}
        </div>
      )}
    </div>
  )
}
