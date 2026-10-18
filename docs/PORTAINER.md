# Running Calino from Portainer with a generated config

This is the short Portainer reference. For the full walkthrough, with every
generator question, checks and troubleshooting, see
[DEPLOY_WITH_GENERATED_CONFIG.md](DEPLOY_WITH_GENERATED_CONFIG.md).

The setup has two parts: a Calino image, and one file, `calino.config.json`,
that holds your accounts encrypted with a master password. The container
serves that file to the browser on every page load. To change accounts, you
regenerate the file. You never rebuild the image for it.

```
scripts/calino-config.mjs ──writes──▶ /opt/calino/calino.config.json  (on the Docker host)
                                              │ bind mount, read-only
                                              ▼
          Calino container ── serves /calino.config.json (Cache-Control: no-store)
                                              │
                                              ▼
                     browser: master password → decrypt → connect accounts
```

Run every command below **on the Docker host that Portainer manages**. With a
Portainer agent on another machine, that means the agent's machine.

## 1. The image

The stack uses `ghcr.io/chrisf4lc0n/calino:latest`, for amd64 and arm64. The
**Publish image** workflow (`.github/workflows/publish-image.yml`) rebuilds it
on every push to `main`, and also tags each build `sha-` plus the first seven
characters of its commit. The package is public, so Portainer needs no
registry entry for it.

The upstream image `ghcr.io/ivan-malinovski/calino` does **not** read a
mounted config.

## 2. Generate the config

```bash
sudo mkdir -p /opt/calino
sudo chown "$(id -u):$(id -g)" /opt/calino
cd /opt/calino
curl -fsSLO https://raw.githubusercontent.com/chrisf4lc0n/calino/main/scripts/calino-config.mjs
docker run --rm -it --network host --user "$(id -u):$(id -g)" \
  -v /opt/calino:/work -w /work node:22-alpine \
  node calino-config.mjs --out /work/calino.config.json
```

With Node.js 18+ on the host, `node calino-config.mjs --out
/opt/calino/calino.config.json` does the same.

The generator asks for each calendar account (server address, username,
password, display name), logs in to test it, and lets you choose which
calendars to sync. Then it asks for optional `.ics` feeds and the master
password. [Step 3 of the full guide](DEPLOY_WITH_GENERATED_CONFIG.md#step-3-generate-the-config)
explains each question.

**Generate the file before you deploy the stack.** If the file is missing,
Docker creates an empty directory in its place and Calino starts without
accounts.

## 3. Create the stack

1. Portainer → **Stacks** → **Add stack**, and name it `calino`.
2. Choose **Repository**, with the repository URL
   `https://github.com/chrisf4lc0n/calino`, the reference `refs/heads/main`
   and the compose path `deploy/portainer-stack.yml`. Or choose **Web editor**
   and paste [`deploy/portainer-stack.yml`](../deploy/portainer-stack.yml).
3. Under **Environment variables**, add:

   | Name | Value | |
   |---|---|---|
   | `CALINO_CONFIG_FILE` | `/opt/calino/calino.config.json` | Required. The path **on the host** |
   | `CALINO_IMAGE` | `ghcr.io/chrisf4lc0n/calino:latest` | Optional; this is the default. Set a `sha-…` tag to stay on one build |
   | `CALINO_PORT` | `8080` | Optional. The host port |

4. **Deploy the stack.**

Open `http://localhost:8080` on the host, or the host's address on port 8080
from another device. Enter the master password once per browser, and the
accounts connect.

## 4. Change accounts later

Run the same `docker run … calino-config.mjs` command as in step 2. When the
file already exists, the generator asks for its master password and then
offers **Keep as is**, **Edit** or **Remove** for each account and feed,
before letting you add new ones. It saves the previous version as
`calino.config.json.bak`.

Then reload Calino in the browser. The file is read on every page load, so
you don't need to restart the stack. On the next load each browser applies
the change:

| Change in the config | What Calino does |
|---|---|
| New account | Connects it |
| Account removed | Removes it, with its calendars and contacts |
| Password, headers or display name changed | Updates the account in place |
| Calendar selection changed | Adds or removes calendars |
| Server address or username changed | Removes the old account and adds a new one |
| New master password | Asks for the password again |

To update Calino, open the stack and click **Pull and redeploy**. The config
file is outside the image, so it is kept.

## Notes

- **CORS.** The browser talks to your calendar servers directly, so each one
  must allow requests from Calino's address. See
  [CORS_PROXY.md](CORS_PROXY.md).
- **Who can read the file.** Anyone who can open Calino can download
  `/calino.config.json`. Everything in it except the display names is
  encrypted, and the file is useless without the master password, so choose a
  long one.
- **Removing everything.** The generator won't write a config with no
  accounts and no feeds. To stop using a config, remove the `volumes` lines
  from the stack.
- **Build-time config.** A `calino.config.json` in the source folder at build
  time is still baked into the bundle, as before. A mounted file takes
  precedence over it.
- **`linkSchemes`.** These are read at build time only. The generator keeps
  them when it rewrites a file.
