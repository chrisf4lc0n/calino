# Self-Hosted CalDAV & Webcal Configuration

## User Guide

### What is this?

A self-hosted Calino can start with its CalDAV/CardDAV accounts and webcal
(`.ics`) subscriptions already set up. The server addresses, usernames and
passwords go into a file, `calino.config.json`, encrypted with a master
password. People who open Calino type that master password once, and every
account and subscription connects.

### Which way to make the config

| Tool | Use it when | Where the file goes |
|---|---|---|
| **`scripts/calino-config.mjs`** (recommended) | You run Calino in Docker and want to change accounts without rebuilding. It tests each login, lets you choose which calendars sync, and edits an existing file | Mounted into the container at `/calino/calino.config.json`, read on every page load |
| **The `/setup` page** | You'd rather not run a script. It runs in the browser; nothing leaves the device | Mount it the same way, or put it in the source folder and rebuild |
| **`scripts/encrypt-password.mjs`** | You want to script each encrypted value yourself | You write the file by hand |

All three produce the same format, so a file from one works with the others.
Only the generator can choose calendars per account.

### Recommended: generator + mounted file

Follow [DEPLOY_WITH_GENERATED_CONFIG.md](DEPLOY_WITH_GENERATED_CONFIG.md). It
pulls the prebuilt image, runs the generator, and starts Calino with the file
mounted, with a check after each step.
[PORTAINER.md](PORTAINER.md) is the short version for Portainer.

A mounted file is served at `/calino.config.json` with
`Cache-Control: no-store`. Regenerating it takes effect on the next page
load. It takes precedence over a file baked in at build time.

### The `/setup` page

1. Open `/setup` on a running Calino. For the Docker image on this machine,
   that is **http://localhost:8080/setup**. The page runs entirely in your
   browser, and credentials never leave your device.
2. Add each CalDAV account (server address, username, password, and **Test
   Connection**), and each webcal subscription (a name and its
   `.ics`/`webcal://` address). For a server behind an authentication gateway,
   add its custom HTTP headers here; each value is encrypted.
3. Set the master password.
4. Click **Generate Config**. Your browser downloads `calino.config.json`.

Then use the file in one of two ways:

- **Mount it** (no rebuild). Copy it to `/opt/calino/calino.config.json` and
  continue from [Step 4 of the deployment guide](DEPLOY_WITH_GENERATED_CONFIG.md#step-4-start-calino).
- **Bake it in.** Copy it to the root of this source folder and rebuild with
  `docker compose up -d --build`. The build log shows
  `[build] Loaded calino.config.json — 1 account(s)`. Every change then needs
  another rebuild.

To edit a `/setup` file later, run the generator on it with the same master
password.

### Writing the file by hand (CLI)

`scripts/encrypt-password.mjs` encrypts one value per run and prints it as
JSON. Pass your own master password and details in place of the quoted
values:

```bash
# A CalDAV account
node scripts/encrypt-password.mjs --master "MASTER PASSWORD" \
  --url "SERVER ADDRESS" --username "USERNAME" --password "PASSWORD"

# A webcal subscription
node scripts/encrypt-password.mjs --master "MASTER PASSWORD" \
  --webcal-url "FEED ADDRESS" --name "Holidays" --refresh-minutes 1440
```

These values end up in your shell history. The generator asks for them
interactively instead, which avoids that.

Put the printed blobs into `calino.config.json`. Each encrypted value has the
shape `{ "ciphertext", "iv", "salt" }`:

```json
{
  "version": 1,
  "accounts": [
    {
      "name": "Personal",
      "url": { "ciphertext": "…", "iv": "…", "salt": "…" },
      "username": { "ciphertext": "…", "iv": "…", "salt": "…" },
      "password": { "ciphertext": "…", "iv": "…", "salt": "…" },
      "headers": {
        "P-Access-Token-Id": { "ciphertext": "…", "iv": "…", "salt": "…" },
        "P-Access-Token": { "ciphertext": "…", "iv": "…", "salt": "…" }
      }
    }
  ],
  "webcalSubscriptions": [
    {
      "name": "Holidays",
      "url": { "ciphertext": "…", "iv": "…", "salt": "…" },
      "refreshIntervalMinutes": 1440
    }
  ]
}
```

- Add one object per account to `accounts`, each with its own encrypted
  values.
- `accounts` and `webcalSubscriptions` are both optional. Leave either out, or
  empty, if you don't need it.
- `headers` is only for a server behind an authentication gateway. It works
  for direct DAV connections only, and the gateway must answer the CORS
  preflight `OPTIONS` request without the secret headers; see
  [AUTH_GATEWAY.md](AUTH_GATEWAY.md).

### Links into other apps

A description or note can hold a link into another app, such as `obsidian://…`
or `anytype://…`. Calino links web and mail addresses by itself; other apps are
listed in `linkSchemes`, scheme → the name a bare link is shown by:

```json
{
  "version": 1,
  "linkSchemes": { "obsidian": "Obsidian", "tg": "Telegram" }
}
```

A bare `obsidian://open?vault=Notes` then shows as **Obsidian ↗** and opens the
app; a markdown link `[Plan](obsidian://…)` keeps its own text. `javascript`,
`vbscript` and `data` are never linked. Links inside code are left as text.

The field needs no accounts. A config that only lists apps asks for no master
password and does not make the build self-hosted: the onboarding and the
Content Security Policy stay those of a regular build. `linkSchemes` is read
at build time only, so it must be in the file in the source folder when you
build.

### What people see

1. They open Calino. A master password box appears over a blurred calendar.
2. They enter the master password. The accounts connect, the subscriptions
   load, and the calendars appear.
3. The browser remembers the password, encrypted in localStorage. Reloading
   doesn't ask again.
4. Clearing the site's data, or clicking the lock icon, brings the prompt
   back.

### Lock

When preconfigured accounts are active, a lock icon appears in the settings
dropdown, next to "All settings". Clicking it:

- removes the encrypted master password from localStorage,
- clears the decrypted credentials from memory,
- shows the master password prompt on the next page load.

The lock does **not** disconnect active CalDAV sessions in the current tab. It
prevents access after the tab is reloaded or closed until the password is
entered again.

### Brute-force protection

The prompt allows 5 attempts, then blocks for 1 minute. The count is shared
across tabs of the same browser.

### Security

| What | Where | Contains |
|------|-------|----------|
| Mounted `calino.config.json`, or the JS bundle for a baked-in config | Server, readable by anyone who can open Calino | Server addresses, usernames, passwords, headers and calendar selection, all encrypted with the master password. Display names are plain text |
| localStorage | The user's browser | The master password, encrypted with the app-level key |
| Memory (Zustand) | The user's browser tab | Decrypted CalDAV passwords |

- **Anyone who can load the page can download the encrypted config.** This
  is by design. Values are encrypted with AES-256-GCM under a key derived
  from the master password, and the blobs are useless without it. Only the
  display names are readable.
- The master password is encrypted at rest in localStorage with AES-256-GCM,
  like CalDAV credentials. The plaintext never touches persistent storage.
- Decrypted CalDAV passwords exist only in memory and are derived again from
  the master password and the config on each page load.
- PBKDF2 with 600,000 iterations makes each guess slow, about 2 seconds in a
  browser. Combined with the attempt limit, a long master password is what
  keeps the file safe.

### CORS requirement

The browser connects directly to your CalDAV server, so the server must allow
cross-origin requests from Calino's address. See [CORS_PROXY.md](CORS_PROXY.md).

### Troubleshooting

| Problem | Solution |
|---------|----------|
| No prompt, with a mounted file | Run `curl -sI http://localhost:8080/calino.config.json`. A `404` means the file isn't mounted; see the [deployment guide's troubleshooting](DEPLOY_WITH_GENERATED_CONFIG.md#troubleshooting) |
| No prompt, with a baked-in file | `calino.config.json` must be in the source folder root during the build. Check the build log for `[build] Loaded calino.config.json` |
| "Wrong password" | The master password must be the one that encrypted the current file |
| Accounts don't connect | Check the browser console. The server must be reachable from the browser and allow CORS |
| The prompt keeps appearing | Something is clearing the site's localStorage, where the remembered password lives |

---

## Technical Reference (for coding agents)

### Architecture Overview

```
/calino.config.json             calino.config.json
(runtime, bind mount,           (project root, build time)
 self-hosted builds only)               │
        │                         vite.config.ts → __CALINO_CONFIG__
        │                               │
        └──────── configLoader.ts ──────┘   runtime file wins
                  (fetch, validate, cache)
                         │
                         ▼
                  configStore.ts  ◀── localStorage: calino.masterPassword
                  (unlock → decrypt → keep in memory)
                         │
                         ▼
                  useCalDAV.ts auto-connect
                  (add, update or remove accounts to match the config;
                   bookkeeping in preconfiguredAccounts.ts)
```

### File Map

| File | Role |
|------|------|
| `vite.config.ts` | Reads `calino.config.json` at build time and injects it as `__CALINO_CONFIG__`; sets `__CALINO_RUNTIME_CONFIG__` for self-hosted builds |
| `docker/Caddyfile` | Serves the bind-mounted `/calino/calino.config.json` at `/calino.config.json` with `Cache-Control: no-store` |
| `src/lib/crypto.ts` | `encryptWithMasterPassword()`, `decryptWithMasterPassword()`, `encryptPassword()`, `decryptPassword()` — PBKDF2 + AES-256-GCM |
| `src/lib/configLoader.ts` | Fetches `/calino.config.json` (self-hosted builds), falls back to `__CALINO_CONFIG__`, validates the schema (`accounts` + `webcalSubscriptions`), caches the result |
| `src/lib/preconfiguredAccounts.ts` | Registry linking stored accounts to config entries, a SHA-256 fingerprint to notice changes, and each account's calendar selection |
| `src/store/configStore.ts` | Zustand store: master password (encrypted at rest), decrypted CalDAV credentials + webcal URLs, unlock/lock actions |
| `src/features/settings/components/MasterPasswordPrompt.tsx` | Modal UI for master password entry (with brute-force protection) |
| `src/features/caldav/hooks/useCalDAV.ts` | CalDAV auto-connect logic (lines ~604–655) |
| `src/features/webcal/hooks/useWebcalSubscriptions.ts` | Webcal auto-subscribe logic (mirrors the CalDAV auto-connect effect) |
| `src/features/onboarding/OnboardingModal.tsx` | Hidden when preconfigured accounts exist |
| `src/features/setup/SetupPage.tsx` | Browser-based config generator (`/setup` route) — CalDAV accounts and webcal subscriptions |
| `src/features/setup/SetupPage.module.css` | Setup wizard styles |
| `scripts/calino-config.mjs` | Interactive generator: tests logins, chooses calendars, edits an existing file in place |
| `scripts/encrypt-password.mjs` | CLI tool to encrypt CalDAV passwords or webcal URLs (alternative to `/setup`) |
| `deploy/portainer-stack.yml` | Compose/Portainer stack that mounts the config into the image |
| `calino.config.example.json` | Template config file |

### Encryption Details

- **Algorithm:** AES-256-GCM
- **Key derivation:** PBKDF2 with 600,000 iterations, SHA-256
- **Salt:** 16 bytes, random per password
- **IV:** 12 bytes, random per password
- **Encoding:** base64url (URL-safe base64 without padding)

The scripts (`scripts/calino-config.mjs`, `scripts/encrypt-password.mjs`) and the browser (`src/lib/crypto.ts`) use the same algorithm. The browser's `fromBase64()` function handles base64url-to-standard conversion for `atob()`.

### Auto-Connect Flow

1. `App.tsx` mounts → calls `configStore.loadConfigFile()`
2. `loadConfigFile()` fetches `/calino.config.json` (self-hosted builds only), falls back to the build-time `__CALINO_CONFIG__`, validates, and caches it
3. If config exists and master password is in localStorage → calls `unlock(storedPassword)`
4. `unlock()` decrypts all account passwords → sets `isUnlocked = true`
5. `useCalDAV` effect watches `isUnlocked` → triggers auto-connect
6. Auto-connect iterates config accounts sequentially (not concurrently!)
7. For each account: calls `addAccount()` which discovers server, tests connection, saves credentials, fetches calendars and events
8. Accounts recorded in the registry but missing from the config are removed; accounts whose fingerprint or calendar selection changed are updated in place

The fingerprint uses `@noble/hashes`, not `crypto.subtle`: browsers hide SubtleCrypto on plain-HTTP origins, such as an instance opened by LAN address.

### Critical: Sequential Auto-Connect

The auto-connect loop **must** run sequentially (`await` in a `for` loop), not concurrently. The reason:

`saveCredentials()` in `src/features/caldav/client/credentials.ts` does a read-modify-write on localStorage:
```typescript
const stored = getAllStoredCredentials()  // read
stored.push(newCredential)                // modify
localStorage.setItem(...)                 // write
```

If two `addAccount()` calls run concurrently, they read the same state, both push, and the last write clobbers the first credential. This causes "Credentials not found" errors when enabling settings sync.

### Module-Level Guard

`autoConnectDone` is a **module-level** variable (not a `useRef`), because `useCalDAV()` is called in 14+ components. Each hook instance would have its own ref, causing auto-connect to run 14 times. The module-level variable is shared across all instances.

### Onboarding Modal

`OnboardingModal.tsx` checks `hasPreconfiguredAccounts` from `configStore`. If true, it returns `null` — the onboarding wizard is hidden since the user doesn't need to manually add a CalDAV account.

### Config Validation

`configLoader.ts` validates the config strictly:
- `version` must be `1`
- `accounts` must be an array (it may be empty when webcal subscriptions are configured)
- Each account needs `name`, `url`, `username` (non-empty strings)
- `password` must have `ciphertext`, `iv`, `salt` (strings) — checked via `isMasterEncryptedData()`
- Invalid accounts are skipped with a warning, not fatal
- Returns `null` if no config was injected, the envelope is invalid, or both collections are empty

### localStorage Keys

| Key | Content |
|-----|---------|
| `calino.masterPassword` | Master password (encrypted with app-level key, `{ iv, data }` JSON) |
| `calino_caldav_credentials` | CalDAV credentials (encrypted with app-level key) |
| `calino_caldav_accounts` | Account metadata (server URL, credential ID, etc.) |

Both the master password and CalDAV credentials are encrypted with the same app-level key (`APP_SECRET` in `crypto.ts`). Plaintext never touches localStorage.

### Rate Limiting Keys (localStorage)

| Key | Content |
|-----|---------|
| `calino.masterPassword.attempts` | Failed unlock attempt count (shared across tabs, reset on success or after cooldown) |
| `calino.masterPassword.blockedUntil` | Timestamp when the block expires |

### Testing Locally

An end-to-end run against a throwaway Radicale server, using only Docker. The
test login is `alice` / `alicepass`, and the master password is
`testmaster123`.

```bash
# 1. A CalDAV server with a user and two calendars, on port 5232
mkdir -p /tmp/radicale && cd /tmp/radicale
printf '[server]\nhosts = 0.0.0.0:5232\n[auth]\ntype = htpasswd\nhtpasswd_filename = /config/users\nhtpasswd_encryption = plain\n[storage]\nfilesystem_folder = /data/collections\n[headers]\nAccess-Control-Allow-Origin = *\nAccess-Control-Allow-Methods = GET, POST, PUT, DELETE, PROPFIND, PROPPATCH, REPORT, OPTIONS, MKCOL, MKCALENDAR, COPY, MOVE\nAccess-Control-Allow-Headers = Authorization, Content-Type, Depth, Prefer, If-None-Match, If-Match\nAccess-Control-Expose-Headers = ETag, DAV, Allow\n' > config
echo 'alice:alicepass' > users
docker run -d --name calino-test-dav -p 5232:5232 \
  -v "$PWD/config:/config/config:ro" -v "$PWD/users:/config/users:ro" \
  tomsquest/docker-radicale:latest
until curl -so /dev/null http://localhost:5232/; do sleep 1; done
for c in work personal; do
  curl -s -u alice:alicepass -X MKCALENDAR "http://localhost:5232/alice/$c/"
done

# 2. Build the image and generate a config (from the project root)
cd -
docker build -t calino:local .
mkdir -p /tmp/calino-test && cp scripts/calino-config.mjs /tmp/calino-test/
printf '%s\n' y http://localhost:5232/ alice alicepass Alice n n 1 n n testmaster123 testmaster123 |
  docker run --rm -i --network host --user "$(id -u):$(id -g)" \
    -v /tmp/calino-test:/work -w /work node:22-alpine \
    node calino-config.mjs --out /work/calino.config.json

# 3. Run Calino with the config mounted
docker run -d --name calino-test -p 8080:8080 \
  -v /tmp/calino-test/calino.config.json:/calino/calino.config.json:ro calino:local
curl -sI http://localhost:8080/calino.config.json   # 200, Cache-Control: no-store
```

Open http://localhost:8080 and enter `testmaster123`. One of the two
calendars connects; which one depends on the order Radicale lists them in.
Re-run step 2's generator without the pipe to edit the file, reload, and the
change applies. Clean up with
`docker rm -f calino-test calino-test-dav && rm -rf /tmp/radicale /tmp/calino-test`.

The automated equivalent is `e2e/runtime-config.spec.ts`
(`pnpm test:e2e e2e/runtime-config.spec.ts`), which serves the config through
`page.route` and the mock CalDAV server.

### Known Limitations

- No support for changing master password without re-encrypting all passwords/URLs (`scripts/calino-config.mjs` does the re-encryption for you)
- A build-time config requires a rebuild to update (it's baked into the JS bundle); a runtime config mounted at `/calino/calino.config.json` does not — see [DEPLOY_WITH_GENERATED_CONFIG.md](DEPLOY_WITH_GENERATED_CONFIG.md)
- Preconfigured accounts and webcal subscriptions are read-only in the settings UI (can't delete or edit them)
- Lock does not disconnect active CalDAV sessions in the current tab
- Webcal subscriptions are always read-only in Calino regardless of config, same as manually-added ones
