# low-scroll

Self-hosted Instagram digest service. Scrapes posts and stories from accounts you follow, stores media locally, and serves them through a clean web feed. Optionally sends email digests via Resend.

## Architecture

Three Docker containers behind Caddy reverse proxy:

- **Scraper** (Python) — fetches posts/stories via Instagram's web API, downloads media, stores in SQLite
- **Web** (Next.js) — serves the feed UI, settings page, and API
- **Caddy** — HTTPS reverse proxy with automatic TLS

SQLite database and media files are shared via Docker volumes.

## Setup

```bash
cp .env.example .env
# Edit .env with your values
docker compose up -d
```

### Environment Variables

| Variable | Description |
|---|---|
| `ADMIN_PASSWORD` | Password for the web UI |
| `ENCRYPTION_KEY` | 64-char hex key for encrypting stored cookies |
| `BASE_URL` | Public URL (e.g. `https://ig.raakode.dk`) |
| `RESEND_API_KEY` | Resend API key for email digests (optional) |
| `EMAIL_RECIPIENT` | Email address for digest delivery (optional) |
| `CRON_SCHEDULE` | Scrape schedule in cron syntax (default: `0 8 * * *`) |

Generate an encryption key:

```bash
openssl rand -hex 32
```

## Usage

1. Log in to the web UI with your admin password
2. Go to **Settings** and paste your Instagram session cookies (`sessionid`, `csrftoken`, `ds_user_id`)
3. Click **Test Cookies** to verify they work from the server
4. The scraper runs on the configured cron schedule and on startup

### Chrome Extension

The `extension/` directory contains a Chrome extension for one-click cookie sync. Load it as an unpacked extension, configure the instance URL and password, then click "Sync Cookies" while logged into Instagram.

## Development

```bash
# Scraper tests
cd scraper && pip install -r requirements.txt && python -m pytest tests/

# Web dev server
cd web && npm install && npm run dev
```

## Deploy

```bash
./deploy.sh  # rsync + docker compose up --build
```
