# Deploy Calino on your own machine with a generated config

This guide gets Calino running in Docker on your own computer or server with
all your calendar accounts set up in advance. Everyone who opens it types a
single master password, and the accounts, the calendars you chose and any
`.ics` feeds then connect by themselves.

Calino comes as a prebuilt image, so nothing is compiled on your machine and
you don't need a registry login. You only download two files: the config
generator and a Compose file.

You will:

1. Make a deployment folder, `/opt/calino`, and download the two files.
2. Pull the Calino image.
3. Run the config generator, which writes an encrypted `calino.config.json`.
4. Start Calino with that file mounted.
5. Open Calino and unlock it.
6. Re-run the generator whenever accounts change. No rebuild is needed.

---

## Before you start

You need:

- **Docker** with the Compose plugin (`docker compose version` prints a
  version).
- **`curl`**, to download the generator and the Compose file.
- **Node.js 18 or newer** is optional. Without it, the generator runs in a
  throwaway `node:22-alpine` container.

For each calendar account, have ready:

- the server's DAV address (see the table in [Step 3](#step-3-generate-the-config)),
- the username,
- the password. Use an app password if your server offers them, as Nextcloud
  and Fastmail do.

Two things about your calendar servers matter before you begin:

- **Calino's browser tab talks to the calendar servers directly.** The address
  you give the generator has to work from the browsers that open Calino, not
  only from this machine. `http://localhost:5232` only works for a browser
  running on the same machine as the server.
- **Each server must allow CORS from Calino's address**, for example
  `http://localhost:8080`, or whatever address people type to reach Calino. Nextcloud
  and Baïkal need configuring; see [CORS_PROXY.md](CORS_PROXY.md) for the
  headers, or for a proxy if you cannot change the server.

---

## Step 1: Make the deployment folder

Everything the deployment needs lives in one folder on the host. This guide
uses `/opt/calino`.

> **`/opt/calino` is only an example.** You can use any folder, such as
> `/srv/calino` or `~/calino`. If you do, replace `/opt/calino` in every
> command below, including the `CALINO_CONFIG_FILE` line in `.env` in Step 4.

```bash
sudo mkdir -p /opt/calino
sudo chown "$(id -u):$(id -g)" /opt/calino
cd /opt/calino
curl -fsSLO https://raw.githubusercontent.com/chrisf4lc0n/calinowcg/main/scripts/calino-config.mjs
curl -fsSL -o docker-compose.yml https://raw.githubusercontent.com/chrisf4lc0n/calinowcg/main/deploy/portainer-stack.yml
```

By the end of Step 4, `/opt/calino` holds:

| File | What it is |
|---|---|
| `calino-config.mjs` | The config generator. One file, no `npm install` |
| `calino.config.json` | Your accounts, encrypted. Made in Step 3 |
| `calino.config.json.bak` | The previous version. Made each time you edit the config |
| `docker-compose.yml` | Runs the Calino container |
| `.env` | Tells `docker-compose.yml` which image, port and config file to use |

Calino keeps nothing else on the server, not even in a Docker volume: the
container is stateless. Calendars and contacts stay on your calendar servers,
and each user's settings and remembered password live in their browser.

---

## Step 2: Pull the image

```bash
docker pull ghcr.io/chrisf4lc0n/calinowcg:latest
```

The image is public, for amd64 and arm64. The **Publish image** workflow
(`.github/workflows/publish-image.yml`) rebuilds it on every push to `main` of
[chrisf4lc0n/calinowcg](https://github.com/chrisf4lc0n/calinowcg). Each build is also
tagged `sha-` plus the first seven characters of its commit; the
[package page](https://github.com/chrisf4lc0n/calinowcg/pkgs/container/calinowcg)
lists them. Use one of those tags instead of `latest` to stay on one build.

The upstream image `ghcr.io/ivan-malinovski/calino` does **not** read a
mounted config, so it won't work with this guide.

> **Building the image yourself instead?** From a clone of the repository,
> run `docker build -t calino:local .` and use `calino:local` wherever this
> guide says `ghcr.io/chrisf4lc0n/calinowcg:latest`. The `Dockerfile` builds a
> self-hosted image by default (`CALINO_SELF_HOSTED=true`), which is what makes
> Calino read the mounted config; don't turn it off.

---

## Step 3: Generate the config

```bash
cd /opt/calino
```

Then start the generator in one of two ways.

**Without Node.js (runs in a container):**

```bash
docker run --rm -it --network host --user "$(id -u):$(id -g)" \
  -v /opt/calino:/work -w /work node:22-alpine \
  node calino-config.mjs --out /work/calino.config.json
```

What the flags do:

- `-it` lets the generator ask questions and hide passwords as you type.
- `--network host` lets the generator reach every server this machine can
  reach, including ones on `localhost`.
- `--user "$(id -u):$(id -g)"` makes the file belong to you, not to `root`, so
  you can edit it again later.

**With Node.js 18+ installed:**

```bash
node calino-config.mjs --out /opt/calino/calino.config.json
```

The generator asks its questions in this order.

### 3.1 Add a calendar account

```
── DAV accounts (calendars + contacts) ──
Add each server login once: Calino syncs both its calendars (CalDAV)
and its address books (CardDAV) from the same account.
Add a DAV account? [Y/n]:
```

Press Enter. The generator asks for each detail in turn:

| Prompt | What to type |
|---|---|
| `Server URL` | The server's DAV address. See the next table |
| `Username` | Your login for that server |
| `Password (hidden)` | Nothing appears as you type. That's expected |
| `Display name in Calino` | The account's label in Calino. Press Enter to use the username |
| `Add custom HTTP headers …? [y/N]` | Press Enter (no), unless the server sits behind an authentication gateway that needs extra headers. See [AUTH_GATEWAY.md](AUTH_GATEWAY.md) |

What the server address looks like:

| Server | Type this |
|---|---|
| Nextcloud | Your Nextcloud address followed by `/remote.php/dav` |
| Baïkal | Your Baïkal address followed by `/dav.php` |
| Radicale | Radicale's address and port, nothing after it |
| Davis | Davis address and port `/dav`|
| Fastmail, iCloud and most other services | The CalDAV address from the service's own help pages |

If you leave out `https://`, the generator adds it. For a server that only
speaks plain HTTP, type `http://` yourself. A bare server address usually
works too, because the generator looks up `/.well-known/caldav` and
`/.well-known/carddav`.

The generator then logs in to check the details. A successful check from a
test run looks like this:

```
  Testing login and looking for calendars and address books… ok
  Found 3 calendar(s) and 1 address book(s).
  Address books (all synced as contacts): Contacts
```

One account covers both the server's calendars and its contacts, so add each
login only once.

**If the check fails**, the generator says why and offers four choices:

| Choice | Use it when |
|---|---|
| 1) Re-enter the details | You mistyped the address, username or password |
| 2) Retry the test | The server was briefly unreachable |
| 3) Keep it untested | This machine can't reach the server but the people using Calino can. The account syncs all its calendars |
| 4) Discard this account | You don't want it after all |

### 3.2 Choose the calendars to sync

```
  Calendars on this account:
     1) [x] Holidays
     2) [x] Work
     3) [x] Personal
  Sync ALL 3 calendars (including ones created later)? [Y/n]:
```

- Press **Enter** to sync every calendar, including calendars you create on
  the server later.
- Type **n** to choose by number. Separate numbers with commas, and use a dash
  for a range: `1,2` or `1,3-5`. The generator confirms the choice:

  ```
    Which calendars to sync? Numbers, e.g. 1,3,5-7: 1,2
    Selected: Holidays, Work
  ```

  Calendars you leave out are never downloaded. Calendars created on the
  server later are not added either; re-run the generator to include them.

Address books always sync in full.

Next, `Add another DAV account? [y/N]` lets you repeat 3.1 and 3.2 for every
other server or login. Press Enter when you have added them all.

### 3.3 Add calendar feeds (optional)

```
── Read-only calendar feeds (.ics / webcal) ──
Add a calendar feed? [y/N]:
```

Feeds are read-only calendars published as an `.ics` or `webcal://` link,
such as public holidays or a sports fixture list. Press Enter to skip, or type
**y** and give:

- the feed's address (`webcal://` is changed to `https://` for you),
- a display name,
- how often to refresh it, in minutes. The default is 60. Use 1440 (once a
  day) for feeds that rarely change.

### 3.4 Choose the master password

```
Choose the master password. Everyone who opens Calino enters it once per browser.
Master password (hidden):
Repeat master password:
```

This password encrypts everything in the file, and it is the only thing people
type to unlock Calino. Make it long. Anyone who can open Calino in a browser
can download the encrypted file and try to guess the password offline.

**Save it in your password manager now.** It can't be recovered. If you lose
it, you have to generate a new config from scratch.

### 3.5 Check the result

The generator encrypts the file and prints a summary. From the test run:

```
Encrypting (this takes a few seconds)… done

Wrote /work/calino.config.json
  1 account(s): Alice (2 selected calendar(s))
  0 calendar feed(s): —
```

The path reads `/work/…` when the generator runs in a container. That is
`/opt/calino` on your machine.

Check the file:

```bash
ls -l /opt/calino/calino.config.json
```

It must be a regular file owned by you, not a directory. Only the display
names are readable in it. Server addresses, usernames, passwords, headers and
the calendar selection are all encrypted.

> Never commit `calino.config.json` or `calino.config.json.bak` to git. Both
> names are already in `.gitignore`.

---

## Step 4: Start Calino

**Make the config file before you start the container.** If the file is
missing when the container starts, Docker creates an empty *directory* in its
place and Calino starts without accounts. [Troubleshooting](#troubleshooting)
explains how to recover.

Tell `docker-compose.yml` what to run, then start it:

```bash
cd /opt/calino
cat > .env <<'EOF'
CALINO_CONFIG_FILE=/opt/calino/calino.config.json
CALINO_IMAGE=ghcr.io/chrisf4lc0n/calinowcg:latest
CALINO_PORT=8080
EOF
docker compose up -d
```

| Setting | Meaning |
|---|---|
| `CALINO_CONFIG_FILE` | The config file on this machine. The container reads it read-only |
| `CALINO_IMAGE` | The image from Step 2. Set a `sha-…` tag to stay on one build, or `calino:local` for an image you built |
| `CALINO_PORT` | The port Calino is reachable on. Change it if 8080 is taken |

The same thing as a single command, without Compose:

```bash
docker run -d --name calino --restart unless-stopped -p 8080:8080 \
  -v /opt/calino/calino.config.json:/calino/calino.config.json:ro \
  ghcr.io/chrisf4lc0n/calinowcg:latest
```

### Using Portainer instead

1. **Stacks** → **Add stack**, and name it `calino`.
2. Choose **Repository** and enter the repository URL
   `https://github.com/chrisf4lc0n/calinowcg`, the reference `refs/heads/main`
   and the compose path `deploy/portainer-stack.yml`. Or choose **Web editor**
   and paste the contents of `/opt/calino/docker-compose.yml`.
3. Under **Environment variables**, set `CALINO_CONFIG_FILE` to
   `/opt/calino/calino.config.json`, either way:
   - **Type it in:** click **Add an environment variable** and fill in the
     name and value. **Advanced mode** takes several `NAME=value` lines at
     once.
   - **Load it from a file:** click **Load variables from .env file** and pick
     a file whose name ends in `.env`, such as `calino.env`, containing:

     ```
     CALINO_CONFIG_FILE=/opt/calino/calino.config.json
     CALINO_PORT=8080
     CALINO_IMAGE=ghcr.io/chrisf4lc0n/calinowcg:latest
     ```

   Only `CALINO_CONFIG_FILE` is required. The image defaults to
   `ghcr.io/chrisf4lc0n/calinowcg:latest`, and the port to 8080.
4. **Deploy the stack.**

[PORTAINER.md](PORTAINER.md#3-create-the-stack) covers both ways in more
detail, and the error Portainer shows when the variable is missing.

The config file must be on the Docker host that Portainer manages. With a
Portainer agent on another machine, run Steps 1 and 3 on that machine.

---

## Step 5: Check that it works

```bash
cd /opt/calino
docker compose ps
```

`STATUS` should say `(healthy)` within about 30 seconds:

```
NAME              IMAGE                               …   STATUS                        PORTS
calino-calino-1   ghcr.io/chrisf4lc0n/calinowcg:latest   …   Up About a minute (healthy)   0.0.0.0:8080->8080/tcp, …
```

Check that Calino serves the config:

```bash
curl -sI http://localhost:8080/calino.config.json
```

You should see these three lines among the output:

```
HTTP/1.1 200 OK
Cache-Control: no-store
Content-Type: application/json
```

`404 Not Found` means the file isn't mounted; see
[Troubleshooting](#troubleshooting).

Now open Calino in a browser:

1. On this machine, go to **http://localhost:8080**.
2. A **master password** box appears over a blurred calendar.
3. Enter the master password. The accounts connect, the calendars you chose
   load, and contacts and feeds appear. The sidebar's **Calendars** count shows
   only the calendars you selected.
4. Reload the page. You aren't asked again: this browser remembers the
   password, encrypted, until someone clicks the lock icon in the settings
   menu or clears the site's data.

**From another device on your network**, use this machine's address. Print it
with:

```bash
hostname -I | awk '{print $1}'
```

If that prints `192.168.1.20`, open `http://192.168.1.20:8080`. Each calendar
server must allow CORS from that address as well.

To let other people use Calino, give them the address and the master
password.

### HTTPS

For access from outside your network, put Calino behind a reverse proxy such
as Caddy, Traefik or Nginx Proxy Manager, forwarding to port 8080. Nothing in
Calino changes. Add the final `https://` address to each calendar server's
CORS settings. [DOCKER.md](DOCKER.md#reverse-proxy) has example proxy
configurations.

---

## Step 6: Change accounts later

1. Run the generator on the same file. Use the same command as in Step 3:

   ```bash
   cd /opt/calino
   docker run --rm -it --network host --user "$(id -u):$(id -g)" \
     -v /opt/calino:/work -w /work node:22-alpine \
     node calino-config.mjs --out /work/calino.config.json
   ```

2. At `A config already exists there. Edit it (otherwise start from
   scratch)? [Y/n]`, press Enter, then type the current master password.
3. Each existing account and feed is shown with three choices: **Keep as
   is**, **Edit** or **Remove**. When you edit, pressing Enter keeps the value
   in brackets, and an empty password keeps the current one. Editing an
   account also lets you change its calendar selection.
4. Add any new accounts or feeds.
5. At `Keep the current master password? [Y/n]`, press Enter to keep it, or
   type **n** to choose a new one.
6. Reload Calino in the browser. You don't need to rebuild or restart.

The generator saves the previous version as `calino.config.json.bak`.

On its next load, each browser applies the change:

| Change in the config | What Calino does |
|---|---|
| New account | Connects it |
| Account removed | Removes it, with its calendars and contacts |
| Password, headers or display name changed | Updates the account in place |
| Calendar selection changed | Adds or removes calendars |
| Server address or username changed | Removes the old account and adds a new one |
| New master password | Asks for the password again |

Only change the file with the generator. The generator rewrites the file in
place, so the running container sees the new version at once. Editors that
save by replacing the file break the mount until the container restarts, and
the values are encrypted anyway.

### Undo the last change

```bash
cp /opt/calino/calino.config.json.bak /opt/calino/calino.config.json
```

Then reload Calino.

### Update Calino itself

```bash
cd /opt/calino
docker compose pull
docker compose up -d
```

In Portainer, open the stack and click **Pull and redeploy** (a Repository
stack), or **Editor** → **Update the stack** with **Re-pull image and
redeploy** turned on (a Web editor stack). With an image
you built, rebuild it with `docker build -t calino:local .` and run
`docker compose up -d --force-recreate`. The config lives outside the image,
so updates keep it.

---

## Troubleshooting

| What you see | Cause and fix |
|---|---|
| No master password box; Calino shows its normal welcome screen | The config isn't reaching the app. Run `curl -sI http://localhost:8080/calino.config.json`. On `404`, check `CALINO_CONFIG_FILE` in `/opt/calino/.env`. Also check that `CALINO_IMAGE` is `ghcr.io/chrisf4lc0n/calinowcg`, not the upstream image |
| `ls -l` shows `/opt/calino/calino.config.json` is a directory | The container started before the file existed. Run `cd /opt/calino && docker compose down && rmdir calino.config.json`, then do Step 3 and Step 4 again |
| Portainer: the stack fails with `required variable CALINO_CONFIG_FILE is missing a value` | The stack has no `CALINO_CONFIG_FILE` variable, or it is misspelled. Open the stack → **Editor**, add it, and click **Update the stack** |
| "Wrong password" in the browser | Use the password of the **current** file. If you changed it in the generator, the new one applies |
| Generator: `login rejected (HTTP 401)` | Wrong username or password, or the server wants an app password |
| Generator: `no DAV principal found at that URL` | The address is wrong. Use the full DAV path from the table in Step 3 |
| Generator: `could not reach the server` | This machine can't reach the server (DNS, firewall or certificate). Fix that, or choose **Keep it untested** if the browsers can reach it |
| Generator: `EACCES: permission denied` when editing | The file belongs to `root` because an earlier run lacked `--user`. Run `sudo chown "$(id -u):$(id -g)" /opt/calino/calino.config.json*` |
| Unlocks, but no calendars appear | Usually CORS. Open the browser's developer console. The calendar server must allow Calino's exact address. See [CORS_PROXY.md](CORS_PROXY.md). In Calino, **Settings → Sync → Diagnose** tests the server step by step |
| A calendar created on the server doesn't appear | That account syncs a fixed selection. Re-run the generator, edit the account, and add the calendar or choose to sync all |
| Changes don't appear after regenerating | Reload the page. If they still don't appear, run `docker compose restart` in `/opt/calino`: the file was replaced rather than rewritten |
| Generator ends with `No accounts or feeds — nothing to write.` | A config needs at least one account or feed. To stop using a config, remove the `volumes` lines from `docker-compose.yml` |

Background on the encryption is in [SELF_HOSTED_CONFIG.md](SELF_HOSTED_CONFIG.md).
