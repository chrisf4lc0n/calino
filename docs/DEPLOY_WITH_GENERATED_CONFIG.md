# Step by step: generate a config and deploy Calino with it

This guide takes you from nothing to a running Calino where every user only
types one master password and all your CalDAV/CardDAV accounts, chosen
calendars, and `.ics` feeds connect by themselves.

You will:

1. Get a Calino image (the prebuilt one, or built yourself).
2. Run `scripts/calino-config.mjs` to create an encrypted `calino.config.json`.
3. Mount that file into the container and start it.
4. Open Calino and unlock it with the master password.
5. Re-run the generator whenever accounts change. No rebuild is needed.

Background on how the encryption works is in
[SELF_HOSTED_CONFIG.md](SELF_HOSTED_CONFIG.md). The short Portainer reference
is in [PORTAINER.md](PORTAINER.md).

---

## What you need

| Requirement | Why |
|---|---|
| A Linux host with Docker (with or without Portainer) | Runs the Calino container |
| Node.js 18+ on the host, **or** the ability to run a `node:22-alpine` container | Runs the generator. It is a single file with no `npm install` |
| Network access from the host to your DAV servers | The generator logs in to each server to test it and list its calendars |
| DAV servers that allow CORS from Calino's address | The browser talks to the DAV servers directly. See [CORS_PROXY.md](CORS_PROXY.md) |

The steps below use `/opt/calino` as the folder on the host. You can use any
path, but keep it the same everywhere.

---

## Step 1: Get an image

Pick one of these:

**Option A: prebuilt image (recommended)**

The image is `ghcr.io/chrisf4lc0n/calino:latest`, for amd64 and arm64. The
**Publish image** workflow (`.github/workflows/publish-image.yml`) rebuilds it
on every push to `main` of
[chrisf4lc0n/calino](https://github.com/chrisf4lc0n/calino), and each build also
gets a `sha-<commit>` tag (the first seven characters of the commit) that you
can pin. The package is public, so the host needs no registry login.

Check that the host can pull it:

```bash
docker pull ghcr.io/chrisf4lc0n/calino:latest
```

The upstream image, `ghcr.io/ivan-malinovski/calino`, does not read a mounted
config, so it does not work with this guide.

**Option B: build it on the host**

```bash
git clone https://github.com/chrisf4lc0n/calino.git
cd calino
docker compose build
```

`docker-compose.yml` builds with `CALINO_SELF_HOSTED=true`, which is what
makes the app look for a mounted config. Keep that setting if you build the
image any other way. A build without it ignores the mounted file.

---

## Step 2: Download the generator

```bash
sudo mkdir -p /opt/calino
sudo chown "$USER" /opt/calino
cd /opt/calino
curl -fsSLO https://raw.githubusercontent.com/chrisf4lc0n/calino/main/scripts/calino-config.mjs
```

If you cloned the repository in Option B, you can use
`scripts/calino-config.mjs` from the clone instead.

Check that it runs:

```bash
node calino-config.mjs --help
```

No Node on the host? Use a throwaway container. Every `node …` command in this
guide then becomes:

```bash
docker run --rm -it -v /opt/calino:/work -w /work node:22-alpine \
  node calino-config.mjs --out /work/calino.config.json
```

Keep the `-it` flags. The generator asks questions and hides passwords as you
type them.

---

## Step 3: Generate the config

Run:

```bash
node calino-config.mjs --out /opt/calino/calino.config.json
```

Without `--out`, the file is written to `./calino.config.json`.

The generator asks its questions in this order.

### 3.1 DAV accounts (calendars and contacts)

Answer **y** to `Add a DAV account?` and enter:

| Prompt | What to enter |
|---|---|
| Server URL | The DAV address, e.g. `https://cloud.example.com/remote.php/dav` (Nextcloud) or `https://dav.example.com/dav.php` (Baïkal). If you leave out `https://`, it is added for you. The server's root URL usually works too, because the generator tries `/.well-known/caldav` and `/.well-known/carddav` |
| Username | The DAV login |
| Password | Hidden while you type. Use an app password if the server supports them |
| Display name in Calino | The label users see. It defaults to the username |
| Custom HTTP headers | Answer **n** unless the server sits behind an auth gateway that needs extra headers, such as `P-Access-Token`. Header values are hidden and encrypted |

The generator then logs in and prints what it found:

```
  Testing login and looking for calendars and address books… ok
  Found 4 calendar(s) and 1 address book(s).
  Address books (all synced as contacts): Contacts
```

One account covers both the server's calendars (CalDAV) and its address
books (CardDAV). Add each server login only once.

If the test fails, you get four choices:

1. **Re-enter the details.** Use this for a typo in the URL or password.
2. **Retry the test.** Use this if the server was briefly unreachable.
3. **Keep it untested.** The account is saved anyway and syncs all calendars.
   This is useful when the host cannot reach a server that users' browsers can.
4. **Discard this account.**

### 3.2 Choose calendars

```
  Calendars on this account:
     1) [x] Personal
     2) [x] Work
     3) [x] Birthdays
     4) [x] Holidays
  Sync ALL 4 calendars (including ones created later)? [Y/n]:
```

- Answer **y** to sync every calendar, including ones created on the server
  later.
- Answer **n** to pick by number, e.g. `1,2` or `1,3-4`. Calendars you leave
  out are never downloaded. Calendars created later are **not** added, so
  re-run the generator to include them.

Address books are always synced in full.

Then `Add another DAV account?` lets you repeat 3.1–3.2 for each further
server or login.

### 3.3 Calendar feeds (optional)

Read-only `.ics` / `webcal://` subscriptions, such as public holidays. Answer
**y** to `Add a calendar feed?` and enter:

- **Calendar feed URL.** `webcal://` is changed to `https://` automatically.
- **Display name.**
- **Refresh every N minutes.** The default is 60. Use 1440 for feeds that
  rarely change.

### 3.4 Master password

```
Choose the master password. Everyone who opens Calino enters it once per browser.
Master password (hidden):
Repeat master password:
```

This password encrypts everything in the file, and users type it to unlock
Calino. Use a long one: anyone who can open Calino can download the encrypted
file and try to guess the password offline.

**Store it in your password manager.** There is no way to recover it. If you
lose it, generate a new config from scratch.

### 3.5 Result

```
Encrypting (this takes a few seconds)… done

Wrote /opt/calino/calino.config.json
  2 account(s): Home (2 selected calendar(s)), Work (all calendars)
  1 calendar feed(s): UK holidays
```

Check the file:

```bash
ls -l /opt/calino/calino.config.json        # must be a regular file, not a directory
head -c 300 /opt/calino/calino.config.json  # JSON with "version": 1
```

Only the display names can be read in plain text. URLs, usernames, passwords,
headers and the calendar selection are all encrypted.

> Do not commit `calino.config.json` or `calino.config.json.bak` to git. Both
> are already listed in `.gitignore`.

---

## Step 4: Deploy with the config

**Generate the file before you start the container.** If the host path does
not exist when the container starts, Docker creates an empty **directory**
with that name, and Calino starts without accounts. If that happens, see
[Troubleshooting](#troubleshooting).

In every setup below, the container reads the file from
`/calino/calino.config.json`. The container's web server serves it at
`/calino.config.json` with `Cache-Control: no-store`, so browsers always get
the current version.

Pick the setup that matches how you run containers.

### Option 1: Portainer stack

1. Portainer → **Stacks** → **Add stack**. Give the stack a name, e.g.
   `calino`.
2. Paste the contents of [`deploy/portainer-stack.yml`](../deploy/portainer-stack.yml)
   into the web editor. Alternatively, choose **Repository** with the
   repository URL `https://github.com/chrisf4lc0n/calino`, reference
   `refs/heads/main` and compose path `deploy/portainer-stack.yml`.
3. Under **Environment variables**, add:

   | Name | Value | |
   |---|---|---|
   | `CALINO_CONFIG_FILE` | `/opt/calino/calino.config.json` | required, path **on the host** |
   | `CALINO_IMAGE` | `ghcr.io/chrisf4lc0n/calino:latest` | optional; this is the default. Set a `sha-…` tag here to pin a build |
   | `CALINO_PORT` | `8080` | optional host port |

4. Click **Deploy the stack**.

If Portainer manages a remote Docker host through an agent,
`CALINO_CONFIG_FILE` is a path on **that** host, so the config must be
generated there.

### Option 2: Docker Compose with the prebuilt image

Use the same stack file without Portainer:

```bash
cd /opt/calino
curl -fsSLO https://raw.githubusercontent.com/chrisf4lc0n/calino/main/deploy/portainer-stack.yml

cat > .env <<'EOF'
CALINO_CONFIG_FILE=/opt/calino/calino.config.json
CALINO_IMAGE=ghcr.io/chrisf4lc0n/calino:latest
CALINO_PORT=8080
EOF

docker compose -f portainer-stack.yml up -d
```

### Option 3: Plain `docker run`

```bash
docker run -d --name calino --restart unless-stopped \
  -p 8080:8080 \
  -v /opt/calino/calino.config.json:/calino/calino.config.json:ro \
  ghcr.io/chrisf4lc0n/calino:latest
```

### Option 4: Image built from source (Step 1, Option B)

In `docker-compose.yml`, uncomment the volume and point it at your file:

```yaml
    volumes:
      - /opt/calino/calino.config.json:/calino/calino.config.json:ro
```

Then:

```bash
docker compose up -d --build
```

Do **not** also copy the file into the project root. A `calino.config.json`
in the project root is baked into the JS bundle at build time, and a rebuild
would then be needed to change it. The mounted file takes precedence anyway.

---

## Step 5: Check the deployment

On the host:

```bash
# Container is up and healthy
docker ps --filter name=calino

# The config is served
curl -sI http://localhost:8080/calino.config.json
```

Expect `HTTP/1.1 200 OK`, `Content-Type: application/json` and
`Cache-Control: no-store`. A `404` means the file is not mounted.

Then in a browser:

1. Open `http://<host>:8080`, or your reverse-proxy URL.
2. The **master password** prompt appears over a blurred calendar.
3. Enter the master password. The accounts connect, the selected calendars
   load, and contacts and feeds appear.
4. Reload the page. You are not asked again. The password is remembered
   (encrypted) in this browser until the user clicks the lock icon in the
   settings menu or clears site data.

To share Calino, give users the URL and the master password.

### Putting it behind HTTPS (recommended)

Put Calino behind your reverse proxy (Traefik, Nginx Proxy Manager, Caddy…)
and forward to port 8080 on the container. Nothing in Calino needs to change.
Make sure each DAV server's CORS settings allow the final `https://` address.

---

## Step 6: Change accounts later

1. Run the generator again on the same file:

   ```bash
   cd /opt/calino
   node calino-config.mjs --out /opt/calino/calino.config.json
   ```

2. Answer **y** to `A config already exists there. Edit it?` and enter its
   current master password.
3. For each existing account and feed, choose **Keep as is**, **Edit** or
   **Remove**. When you edit, pressing Enter keeps the shown value, and an
   empty password keeps the current password. You can also change the
   calendar selection here.
4. Add any new accounts or feeds.
5. `Keep the current master password?`: answer **y** to keep it, or **n** to
   set a new one. Everything is re-encrypted with the new password.
6. The previous version is saved as `calino.config.json.bak` next to the file.
7. Reload Calino in the browser. Restarting the stack/container is optional,
   but it makes sure the container sees the new file.

What each browser does on its next load:

| Change in the config | Effect in Calino |
|---|---|
| New account | Connected automatically |
| Account removed | Removed, with its calendars and contacts |
| Password, headers or display name changed | Updated in place |
| Calendar selection changed | Calendars added or dropped on the next sync |
| URL or username changed | Treated as removing the old account and adding a new one |
| New master password | Unlock prompt shown again |

Always use the generator to change the file. It overwrites the existing file
in place, so the bind mount keeps working. Editors that save by replacing the
file (for example `sed -i` or some IDEs) break a single-file bind mount until
the container is restarted. Hand edits are also impossible anyway, because the
values are encrypted.

### Undo a change

```bash
cp /opt/calino/calino.config.json.bak /opt/calino/calino.config.json
```

Then reload Calino.

### Update Calino itself

- **Prebuilt image:** Portainer → the stack → **Pull and redeploy**, or
  `docker compose -f portainer-stack.yml pull && docker compose -f portainer-stack.yml up -d`.
- **Built from source:** `git pull && docker compose up -d --build`.

The config file is outside the image, so it survives updates.

---

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| No master password prompt; Calino shows the normal onboarding | The config is not reaching the app. Run `curl -sI http://<host>:8080/calino.config.json`. On `404`: check the volume line and that `CALINO_CONFIG_FILE` is the **host** path. If you built the image yourself, it must be built with `CALINO_SELF_HOSTED=true` |
| `/opt/calino/calino.config.json` is a directory | The stack started before the file existed. Stop the stack, run `rmdir /opt/calino/calino.config.json`, generate the config (Step 3), and start the stack again |
| "Wrong password" in the browser | The password must be the one used for the **current** file. If you changed it in the generator, use the new one |
| Generator: `login rejected (HTTP 401)` | Wrong username or password, or the server needs an app password |
| Generator: `no DAV principal found at that URL` | Wrong URL. Try the server's full DAV path, e.g. `…/remote.php/dav` for Nextcloud or `…/dav.php` for Baïkal |
| Generator: `could not reach the server` | DNS, firewall or TLS issue from the **host**. Fix connectivity, or choose **Keep it untested** if the browsers can reach the server |
| Unlocks, but accounts fail to connect | Usually CORS. Open the browser dev tools console. The DAV server must allow Calino's origin. See [CORS_PROXY.md](CORS_PROXY.md) |
| A new calendar on the server doesn't show up | That account has a calendar selection. Re-run the generator, edit the account, and add the calendar (or choose "Sync ALL") |
| Changes don't show up after regenerating | Reload the page. If they still don't show up, restart the container: the file may have been replaced rather than overwritten |
| Generator ends with `No accounts or feeds — nothing to write.` | A config must contain at least one account or feed. To stop using a managed config, remove the volume from the stack instead |
