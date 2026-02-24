# Multi-User Support Design

## Overview

Make low-scroll available to 5-20 friends. Add signup/login, per-user data isolation, a landing page explaining the service, and transparent trust disclosures.

## Trust & Encryption Model

- **Cookies**: encrypted at rest with server-side `ENCRYPTION_KEY` (current approach). The server must decrypt these to scrape -- this is the trust boundary.
- **Scraped content**: stored plaintext. The scraper inherently sees all data, so at-rest encryption adds no real protection.
- **Trust disclosure**: landing page and signup flow clearly explain that the service acts on the user's behalf on Instagram. Users are encouraged to use throwaway accounts and told the tool is only for public account content. Link to GitHub source code provided.

## Data Model

### New tables

```sql
CREATE TABLE users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,  -- Argon2id (salt embedded in hash string)
    is_admin      BOOLEAN DEFAULT false,
    is_active     BOOLEAN DEFAULT true,
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE sessions (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL
);

CREATE TABLE user_config (
    user_id INTEGER NOT NULL REFERENCES users(id),
    key     TEXT NOT NULL,
    value   TEXT,
    PRIMARY KEY (user_id, key)
);
```

### Modified tables

Add `user_id INTEGER NOT NULL REFERENCES users(id)` to:
- `accounts` -- change PK to `(user_id, username)`
- `posts`
- `scrape_runs`
- `manual_runs`
- `fb_groups` -- change PK to `(user_id, group_id)`

Tables that inherit user scope through FKs (no changes needed):
- `media` (via post_id)
- `fb_posts` (via group_id)
- `fb_comments` (via post_id)

Drop the global `config` table -- replaced by `user_config`.

### Fresh start

No migration of existing data. Tables dropped and recreated with new schema.

## Authentication

### Signup
1. User visits `/signup`
2. Sees trust disclaimer + checkbox: "I understand this service acts on my behalf on Instagram"
3. Enters email + password
4. Password hashed with Argon2id (auto-salted, via `argon2` npm package)
5. User row created, redirected to settings

### Login
1. User enters email + password at `/login`
2. Argon2id verify against stored hash
3. Generate 64-char hex session token, insert into `sessions` with 30-day expiry
4. Set `ig_session` cookie (httpOnly, secure, sameSite=lax)

### Middleware
- Look up session token in `sessions` table
- Resolve `user_id`, attach to request context
- All API routes scope queries by `user_id`
- Unauthenticated access allowed: `/`, `/login`, `/signup`, `/api/auth`, `/api/extension/*`

## Scraper Changes

### Per-user scheduling
- Replace single cron job with a polling loop (every 60 seconds)
- For each active user with valid cookies: check if due based on their `cron_schedule` in `user_config`
- If due, run `run_user_scrape(user_id)`

### Per-user scrape flow
```
run_user_scrape(user_id):
    load cookies from user_config
    create InstagramClient
    scrape_all() scoped to user's accounts
    check pending DMs
    if new content or pending DMs:
        build digest with user's posts
        send to user's email_recipient
```

### Polling jobs
Cookie tests, manual runs, triggers -- all check `user_config` for a specific `user_id` instead of global config.

### Browser extension
`/api/extension/cookies` endpoint needs user scoping. Options: API key per user stored in extension config, or token-based auth.

## Web App

### New pages
- `/` -- landing page (unauthenticated). Monospace aesthetic. Sections: hero, how it works (3 steps), trust & transparency, sign up/log in buttons.
- `/signup` -- email + password form with trust disclaimer and acknowledgment checkbox.
- `/login` -- email + password (replaces current password-only page).
- `/admin` -- user list with activate/deactivate toggles (admin only, gated by `is_admin` flag).

### Existing pages
- All current pages remain, scoped to logged-in user's data.
- Authenticated users visiting `/` redirect to feed.

### API routes (all user-scoped)
- `GET /api/feed` -- `WHERE user_id = ?`
- `GET/POST /api/settings` -- read/write `user_config WHERE user_id = ?`
- `POST /api/extension/cookies` -- scoped by user API key or token

## Dependencies

- `argon2` npm package (password hashing in Next.js)
- `croniter` already present in Python requirements
