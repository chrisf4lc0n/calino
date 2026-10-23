# Nginx Proxy Manager: CORS for your DAV server, Authelia for Calino

Two short recipes for [Nginx Proxy Manager](https://nginxproxymanager.com/)
(NPM), taken from a working setup with a Davis server:

1. **CORS on the DAV server's proxy host**, so the browser may talk to it.
2. **Authelia in front of Calino** (optional), so only logged-in people can
   open Calino and download its encrypted config.

The examples use `calendar.example.com` for Calino, `dav.example.com` for the
DAV server and `192.168.1.20` for the Docker host. Replace them with your own.

---

## 1. CORS for the DAV server

Calino's browser tab sends DAV requests straight to your DAV server, so that
server must answer CORS for Calino's address. With NPM in front of it, add the
headers in NPM.

In NPM, open the **DAV server's** proxy host (`dav.example.com`), go to
**Custom locations**, add a location for the DAV path (`/dav` for Davis), point
it at the same backend, and paste this into its advanced settings (the gear
icon):

```nginx
set $cors_origin "";
if ($http_origin ~ ^(https://calendar\.example\.com)$) {
    set $cors_origin $http_origin;
}
add_header Access-Control-Allow-Origin $cors_origin always;
add_header Access-Control-Allow-Methods "GET, PUT, POST, DELETE, PROPFIND, PROPPATCH, REPORT, OPTIONS, MKCOL, MKCALENDAR, COPY, MOVE" always;
add_header Access-Control-Allow-Headers $http_access_control_request_headers always;
add_header Access-Control-Expose-Headers "ETag, DAV, Allow" always;
add_header Access-Control-Max-Age 86400 always;
add_header Vary Origin always;

# Answer the browser's preflight here, without asking for a password.
if ($http_access_control_request_method) {
    return 204;
}

client_max_body_size 50m;
# Davis only: it expects the trailing slash.
rewrite ^/dav$ /dav/ break;
```

What each part does:

- **Allowed origin.** Only Calino's exact address gets CORS headers. If people
  also open Calino under another address, such as `http://192.168.1.20:8080`,
  add it to the pattern: `^(https://calendar\.example\.com|http://192\.168\.1\.20:8080)$`.
- **Methods.** Every DAV method Calino uses. `MKCOL`, `MKCALENDAR`, `COPY` and
  `MOVE` are needed for creating calendars and for settings sync.
- **Allowed headers.** Echoes back whatever the browser asks for
  (`Authorization`, `Depth`, `If-Match` and so on), so nothing is missed.
- **Exposed headers.** Lets Calino read `ETag` (saves a request on every write)
  and `DAV`/`Allow` (used by **Diagnose**).
- **Preflight.** The browser's `OPTIONS` check carries no password, so NPM
  answers it with `204` instead of passing it to the DAV server.

To check it, open Calino, go to **Settings → Sync**, and click **Diagnose** on
the account. Every check should pass.

> **Don't put the DAV server behind Authelia.** Calino's DAV requests are
> background requests with a username and password; they can't follow
> Authelia's login page. Protect Calino itself instead (section 2) and keep
> the DAV host on its own password login.

---

## 2. Authelia in front of Calino (optional)

Calino is a static site, so NPM can require an Authelia login before serving
any of it, including `/calino.config.json`. Strangers then can't even download
the encrypted config. Users log in to Authelia, then enter Calino's master
password once per browser.

**Before you start:** set up the snippet files from Authelia's
[NGINX Proxy Manager guide](https://www.authelia.com/integration/proxies/nginx-proxy-manager/)
(`authelia-location.conf`, `authelia-authrequest.conf` and `proxy.conf`,
mounted into NPM under `/snippets/`), and add `calendar.example.com` to
Authelia's
[access control rules](https://www.authelia.com/configuration/security/access-control/)
with `one_factor` or `two_factor`.

Then add a proxy host for Calino in NPM:

| Tab | Setting |
|---|---|
| Details | Domain `calendar.example.com`, scheme `http`, forward host `192.168.1.20`, forward port `8080` (your `CALINO_PORT`). Websockets support off; Block Common Exploits on is fine |
| SSL | A Let's Encrypt certificate, with **Force SSL**, **HTTP/2** and **HSTS** on |
| Advanced | The block below |

```nginx
include /snippets/authelia-location.conf;

location / {
    include /snippets/proxy.conf;
    include /snippets/authelia-authrequest.conf;
    proxy_pass $forward_scheme://$server:$port;
}
```

Opening `https://calendar.example.com` now goes to the Authelia login first.

Things to know:

- **Session expiry.** When the Authelia session runs out while a Calino tab
  stays open, background syncs fail until you reload the page and log in
  again.
- **Android app.** The Calino Android app can't pass a browser login, so it
  can't use an instance behind Authelia.
- **CORS.** Add `https://calendar.example.com` to the DAV server's allowed
  origin (section 1); the Authelia login doesn't change that.
