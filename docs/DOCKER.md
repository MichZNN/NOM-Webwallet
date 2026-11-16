# Docker deployment (fork)

This fork ships the web app as a container image instead of rsyncing `dist/` to a
server. Everything here is additive: upstream's `deploy.yml` and
`nginx.conf.example` are left untouched so merging upstream stays conflict-free.

| File | Purpose |
| --- | --- |
| `Dockerfile` | Builds the app with Node, serves `dist/` with nginx on port 8080 |
| `docker/nginx.conf`, `docker/security-headers.conf` | SPA routing, caching, CSP, COOP/COEP |
| `docker-compose.yml` | Runs the image read-only, bound to `127.0.0.1:8080` |
| `.github/workflows/deploy-docker.yml` | On push to `main`: test, push image to GHCR, `docker compose up -d` on the server |

## Run locally

```bash
docker build -t nom-webwallet .
docker run --rm -p 127.0.0.1:8080:8080 nom-webwallet
# open http://localhost:8080
```

## Server setup (once)

1. Install Docker with the compose plugin.
2. Create a deploy user that may run docker, and a directory for the compose file:
   ```bash
   sudo mkdir -p /opt/nom-webwallet && sudo chown deploy: /opt/nom-webwallet
   ```
3. Copy `docker-compose.yml` into that directory.
4. Put an HTTPS reverse proxy (Caddy, Traefik, nginx, ...) in front of
   `127.0.0.1:8080`. A wallet must only be served over HTTPS. Don't add security
   headers in the proxy: the container already sends them, and duplicates of
   COOP/COEP/CSP break things.
   Caddy example: `wallet.example.com { reverse_proxy 127.0.0.1:8080 }`

Set `NOM_WEBWALLET_PORT` in a `.env` next to the compose file to use another port.

## GitHub secrets

Settings → Secrets and variables → Actions (or on the `production` environment):

| Secret | Value |
| --- | --- |
| `DOCKER_DEPLOY_SSH_KEY` | Private key of a key pair made for this deploy (`ssh-keygen -t ed25519`) |
| `DOCKER_DEPLOY_KNOWN_HOSTS` | Output of `ssh-keyscan -p <port> -H your-server` (verify the fingerprint) |
| `DOCKER_DEPLOY_HOST` | Server hostname or IP |
| `DOCKER_DEPLOY_PORT` | SSH port of the server (optional, default 22) |
| `DOCKER_DEPLOY_USER` | The deploy user |
| `DOCKER_DEPLOY_PATH` | Directory holding `docker-compose.yml`, e.g. `/opt/nom-webwallet` |

The names differ from upstream's `SSH_*` / `DEPLOY_PATH` on purpose. Upstream's
`deploy.yml` runs `rsync --delete` on `v*` tags; if it found secrets meant for
this setup it would wipe the target directory. Disable "Deploy Web App" under
Actions in the fork as well.

The image is pulled with the workflow's short-lived `GITHUB_TOKEN`, so the
GHCR package can stay private.

## CSP

`docker/security-headers.conf` differs from `nginx.conf.example` where the
example breaks the app: fonts are inlined as `data:` URIs, PoW needs
`'wasm-unsafe-eval'`, and the plasma bot and WalletConnect are reached over
`https:`.
