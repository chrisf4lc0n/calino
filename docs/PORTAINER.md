# Running Calino from Portainer with a generated config

This setup never builds Calino on your server. GitHub builds the image once per
push to `main` of [chrisf4lc0n/calino](https://github.com/chrisf4lc0n/calino). Your server pulls it and mounts one file, `calino.config.json`,
which holds your accounts, encrypted with a master password. To change
accounts, regenerate the file and restart the stack.

For a longer, step-by-step version with other ways to deploy (plain Compose,
`docker run`, an image built from source) and troubleshooting, see
[DEPLOY_WITH_GENERATED_CONFIG.md](DEPLOY_WITH_GENERATED_CONFIG.md).

```
scripts/calino-config.mjs ──writes──▶ /opt/calino/calino.config.json (host)
                                              │ bind mount (read-only)
                                              ▼
ghcr.io/chrisf4lc0n/calino ── Caddy serves /calino.config.json (no-store)
                                              │
                                              ▼
                         browser: master password → decrypt → connect
```

## 1. The image

The **Publish image** workflow (`.github/workflows/publish-image.yml`) builds
`linux/amd64` and `linux/arm64` images and pushes them as
`ghcr.io/chrisf4lc0n/calino:latest`, plus a `sha-<commit>` tag for each build.
The package is public, so Portainer needs no registry entry for it.

The upstream image, `ghcr.io/ivan-malinovski/calino`, does not read a mounted
config.

## 2. Generate the config

The generator is one file with no dependencies. It needs Node.js 18 or newer.

```bash
mkdir -p /opt/calino && cd /opt/calino
curl -fsSLO https://raw.githubusercontent.com/chrisf4lc0n/calino/main/scripts/calino-config.mjs
node calino-config.mjs --out /opt/calino/calino.config.json
```

Without Node on the host:

```bash
docker run --rm -it -v /opt/calino:/work -w /work node:22-alpine \
  node calino-config.mjs --out /work/calino.config.json
```

It asks, in order:

1. **DAV accounts.** For each one it asks for the server URL, username,
   password, a display name, and optional custom headers (only needed for an
   auth gateway). Then it logs in and lists the calendars and address books it
   finds. Calino syncs a server's calendars (CalDAV) and its address books
   (CardDAV) through the same account, so add each server login once.
2. **Sync all calendars?** If you answer no, pick calendars by number
   (`1,3,5-7`). Calendars you leave out are never downloaded. If you answer
   yes, calendars created on the server later are synced too.
3. **Calendar feeds** (`.ics`/`webcal://`, read-only). Optional.
4. **Master password**, entered twice.

Everything is encrypted the same way as in the `/setup` page and
`scripts/encrypt-password.mjs`: PBKDF2-SHA-256 with 600,000 iterations, then
AES-256-GCM with a fresh salt and IV per value. That includes the URLs,
usernames, passwords, headers and the calendar selection. Only the display
names are readable.

## 3. Create the stack

Portainer → Stacks → Add stack. Paste
[`deploy/portainer-stack.yml`](../deploy/portainer-stack.yml), or use
"Repository" with the URL `https://github.com/chrisf4lc0n/calino`, reference
`refs/heads/main` and compose path `deploy/portainer-stack.yml`. Then set the
environment variables:

| Variable | Example | |
|---|---|---|
| `CALINO_CONFIG_FILE` | `/opt/calino/calino.config.json` | required, host path |
| `CALINO_PORT` | `8080` | optional |
| `CALINO_IMAGE` | `ghcr.io/chrisf4lc0n/calino:latest` | optional; the default. Use a `sha-…` tag to pin a build |

Generate the file **before** deploying. If the path does not exist, Docker
creates an empty directory there and Calino starts without accounts.

Open Calino, enter the master password once per browser, and the accounts
connect.

## 4. Changing things later

```bash
node calino-config.mjs --out /opt/calino/calino.config.json
```

When the file already exists, the generator asks for its master password and
then walks through what is there: keep, edit or remove each account and feed,
then add new ones. It keeps a copy of the previous version as
`calino.config.json.bak`.

Then restart the stack in Portainer. The file is fetched on every page load,
so reloading the page is technically enough; the restart just makes sure the
container sees the new file. On the next load each browser applies the
changes:

| Change in the config | What Calino does |
|---|---|
| New account | Connects it |
| Account removed | Removes it, with its calendars and contacts |
| Password, headers or display name changed | Updates the account in place |
| Calendar selection changed | Adds or drops calendars on the next sync |
| URL or username changed | Treated as a removal plus a new account |
| New master password | Shows the unlock prompt again |

## Notes

- **CORS.** The browser talks to your DAV servers directly, so they must
  allow cross-origin requests from Calino's address. See
  [CORS_PROXY.md](CORS_PROXY.md).
- **Who can read the file.** Anyone who can open Calino can download
  `/calino.config.json`. This is the same exposure as before, when the config
  was baked into the public JS bundle. Without the master password the file is
  useless, so choose a strong one.
- **Removing everything.** The generator will not write a config with no
  accounts and no feeds. To stop managing accounts entirely, remove the volume
  from the stack.
- **Build-time config.** A `calino.config.json` in the project root at build
  time still works as before. A mounted runtime file takes precedence over it.
- **`linkSchemes`.** These are still read at build time only. The generator
  preserves them in the file it rewrites.
