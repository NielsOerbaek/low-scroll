# ig-sub: Self-Hosted Instagram Digest Service

## Purpose

A self-hosted service that monitors followed Instagram accounts, archives posts and stories locally, sends configurable email digests, and provides a private web feed at `ig.raakode.dk`.

## Architecture

Three Docker containers behind Caddy reverse proxy:

- **scraper** (Python) - Polls Instagram on a configurable cron schedule, downloads media, stores metadata in SQLite, sends email digests via Resend.
- **web** (Next.js + shadcn) - Serves a private, password-protected web feed. Provides admin settings for cookie management, schedule config, and email settings.
- **caddy** - Reverse proxy with automatic HTTPS via Let's Encrypt for `ig.raakode.dk`.

### Shared Volumes

- `./data/db/ig.db` - SQLite database (scraper writes, web reads)
- `./data/media/` - Downloaded images, videos, story frames
- `./data/caddy/` - Caddy certificate storage

### Configuration

Environment variables (`.env`):
- `ENCRYPTION_KEY` - for encrypting stored cookies
- `RESEND_API_KEY`
- `EMAIL_RECIPIENT`
- `ADMIN_PASSWORD` - initial admin password
- `BASE_URL` - `https://ig.raakode.dk`
- `CRON_SCHEDULE` - default `0 8 * * *`

## Cookie Management

- Settings page in web UI to paste Instagram cookies (`sessionid`, `csrftoken`, `ds_user_id`)
- Cookies stored encrypted in SQLite (AES with key from env)
- On each scrape run, a lightweight auth check validates cookies
- If stale: mark in DB, send alert email via Resend with link to settings page, skip scrape run

## Scraper Service

### Core Loop (each cron tick)

1. Validate cookies via lightweight authenticated request
2. If stale → send alert email, skip run
3. Fetch followed accounts list (cached, refreshed periodically)
4. For each account: fetch posts and stories since last scrape
5. Download new media to `./data/media/{username}/{post_id}/`
6. Insert metadata into SQLite
7. If new content found → build and send digest email via Resend
8. Log run to `scrape_runs` table

### Instagram Interaction

- Uses `instagrapi` library with session cookies
- Small random delays between account requests
- Stores `last_checked_at` per account to avoid re-processing
- ~10-20 accounts, low volume, minimal rate limit concern

### Email Digest

- HTML email (Jinja2 template)
- Grouped by account
- Each post: medium thumbnail, caption (truncated), link to feed
- Each story: thumbnail, timestamp, link to feed
- Footer with account count and link to settings

## Web Feed (Next.js + shadcn)

### Pages

| Route | Description |
|---|---|
| `/` | Main chronological timeline, all posts and stories |
| `/account/{username}` | Per-account filtered view |
| `/post/{id}` | Full detail: full-size media, complete caption, carousel support |
| `/story/{id}` | Full detail: full-screen vertical story frames |
| `/settings` | Cookie input, cron schedule, email config, disk usage |
| `/login` | Password login form |

### API Routes

| Route | Method | Description |
|---|---|---|
| `/api/feed` | GET | Paginated feed, optional `?account=` filter |
| `/api/accounts` | GET | List of followed accounts |
| `/api/media/[...path]` | GET | Serve media files from volume |
| `/api/auth` | POST | Login, returns session cookie |
| `/api/settings` | GET/POST | Read/update config and cookies |

### Auth

- All routes behind password auth (middleware)
- Simple session cookie after login
- Admin password set via env, changeable in settings

## Data Model (SQLite)

### accounts
| Column | Type | Notes |
|---|---|---|
| username | TEXT PK | Instagram username |
| profile_pic_path | TEXT | Local path to profile pic |
| last_checked_at | DATETIME | Last successful scrape |
| added_at | DATETIME | When first seen |

### posts
| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | Instagram post/story ID |
| username | TEXT FK | → accounts.username |
| type | TEXT | post / reel / story |
| caption | TEXT | Post caption |
| timestamp | DATETIME | Original post time |
| permalink | TEXT | Instagram URL |
| created_at | DATETIME | When we scraped it |

### media
| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | Auto-increment |
| post_id | TEXT FK | → posts.id |
| media_type | TEXT | image / video |
| file_path | TEXT | Path relative to media dir |
| thumbnail_path | TEXT | Resized thumbnail path |
| order | INTEGER | Position in carousel |

### config
| Column | Type | Notes |
|---|---|---|
| key | TEXT PK | Config key |
| value | TEXT | Config value (cookies encrypted) |

### scrape_runs
| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | Auto-increment |
| started_at | DATETIME | |
| finished_at | DATETIME | |
| status | TEXT | success / stale_cookies / error |
| new_posts_count | INTEGER | |
| new_stories_count | INTEGER | |

## Project Structure

```
ig-sub/
├── docker-compose.yml
├── .env.example
├── Caddyfile
├── scraper/
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── src/
│   │   ├── main.py
│   │   ├── instagram.py
│   │   ├── scrape.py
│   │   ├── digest.py
│   │   ├── cookies.py
│   │   ├── db.py
│   │   └── config.py
│   └── templates/
│       └── digest.html
├── web/
│   ├── Dockerfile
│   ├── package.json
│   ├── next.config.js
│   ├── src/
│   │   ├── app/
│   │   │   ├── layout.tsx
│   │   │   ├── page.tsx
│   │   │   ├── account/[username]/page.tsx
│   │   │   ├── post/[id]/page.tsx
│   │   │   ├── story/[id]/page.tsx
│   │   │   ├── settings/page.tsx
│   │   │   ├── login/page.tsx
│   │   │   └── api/
│   │   │       ├── feed/route.ts
│   │   │       ├── accounts/route.ts
│   │   │       ├── media/[...path]/route.ts
│   │   │       ├── auth/route.ts
│   │   │       └── settings/route.ts
│   │   ├── components/
│   │   │   ├── post-card.tsx
│   │   │   ├── story-card.tsx
│   │   │   ├── feed.tsx
│   │   │   ├── account-header.tsx
│   │   │   └── settings-form.tsx
│   │   ├── lib/
│   │   │   ├── db.ts
│   │   │   └── auth.ts
│   │   └── middleware.ts
│   └── public/
├── data/
│   ├── db/
│   └── media/
└── docs/
    └── plans/
```

## Deployment

- Docker Compose with three services
- Caddy handles HTTPS automatically via Let's Encrypt
- SQLite in WAL mode for safe concurrent read/write
- Scraper is the only writer; web is read-only
- Media served via Next.js API route from shared volume
- No auto-deletion of media (full archive)
