# Multi-User Support Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform low-scroll from a single-user self-hosted tool into a multi-user service with signup/login, per-user data isolation, per-user scraping schedules, a landing page with trust disclosures, and an admin panel.

**Architecture:** Add a `users` table and scope all data by `user_id`. Auth via Argon2id password hashing + session tokens in DB. Scraper polls every 60s and runs per-user scrapes based on individual cron schedules. Landing page explains the service and trust model transparently.

**Tech Stack:** Next.js 16, better-sqlite3, argon2 (npm), Python 3.12, APScheduler, croniter, Resend

**Design doc:** `docs/plans/2026-02-24-multi-user-design.md`

---

### Task 1: Database Schema — Python Side

Update the Python database layer to create the new multi-user schema. This is the foundation everything else builds on.

**Files:**
- Modify: `scraper/src/db.py` (rewrite `initialize()` and all query methods)
- Modify: `scraper/tests/test_db.py` (rewrite for user-scoped operations)

**Step 1: Write failing tests for new schema**

Replace `scraper/tests/test_db.py` with tests for user-scoped operations. Key tests:

```python
# Test: users table exists and supports insert
def test_insert_user(db):
    user_id = db.insert_user("test@example.com", "$argon2id$hash")
    assert user_id == 1
    user = db.get_user_by_email("test@example.com")
    assert user["email"] == "test@example.com"
    assert user["is_active"] == 1

# Test: user_config replaces global config
def test_user_config(db):
    user_id = db.insert_user("a@b.com", "hash")
    db.set_user_config(user_id, "cron_schedule", "0 8 * * *")
    assert db.get_user_config(user_id, "cron_schedule") == "0 8 * * *"

# Test: accounts are user-scoped
def test_accounts_scoped_by_user(db):
    u1 = db.insert_user("a@b.com", "hash")
    u2 = db.insert_user("c@d.com", "hash")
    db.upsert_account(u1, "alice", None)
    db.upsert_account(u2, "bob", None)
    assert len(db.get_all_accounts(u1)) == 1
    assert db.get_all_accounts(u1)[0]["username"] == "alice"

# Test: posts are user-scoped
def test_posts_scoped_by_user(db):
    u1 = db.insert_user("a@b.com", "hash")
    db.upsert_account(u1, "alice", None)
    db.insert_post(user_id=u1, id="p1", username="alice", post_type="post",
                   caption="hello", timestamp="2026-01-01", permalink="http://x")
    posts = db.get_new_posts_since(u1, "2025-12-31")
    assert len(posts) == 1

# Test: scrape_runs are user-scoped
def test_scrape_runs_scoped(db):
    u1 = db.insert_user("a@b.com", "hash")
    run_id = db.insert_scrape_run(u1)
    db.finish_scrape_run(run_id, "success", 5, 3)
    run = db.get_scrape_run(run_id)
    assert run["user_id"] == u1

# Test: fb_groups are user-scoped
def test_fb_groups_scoped(db):
    u1 = db.insert_user("a@b.com", "hash")
    u2 = db.insert_user("c@d.com", "hash")
    db.upsert_fb_group(u1, "123", "Group A", "http://fb/123")
    db.upsert_fb_group(u2, "456", "Group B", "http://fb/456")
    assert len(db.get_all_fb_groups(u1)) == 1

# Test: get_all_active_users returns active users with cookies
def test_get_all_active_users(db):
    u1 = db.insert_user("a@b.com", "hash")
    u2 = db.insert_user("inactive@b.com", "hash")
    db.deactivate_user(u2)
    db.set_user_config(u1, "ig_cookies", "encrypted_blob")
    users = db.get_all_active_users()
    assert len(users) == 1
    assert users[0]["id"] == u1

# Test: sessions table
def test_sessions(db):
    u1 = db.insert_user("a@b.com", "hash")
    db.insert_session("token123", u1, "2026-03-24")
    session = db.get_session("token123")
    assert session["user_id"] == u1
    # Expired session
    db.insert_session("old", u1, "2020-01-01")
    assert db.get_session("old") is None  # expired
```

**Step 2: Run tests to verify they fail**

Run: `cd /home/niec/Documents/repos/ig-sub/scraper && python -m pytest tests/test_db.py -v`
Expected: FAIL (methods don't exist yet)

**Step 3: Rewrite `db.py` with new schema**

Key changes to `scraper/src/db.py`:

- `initialize()`: Drop all old tables, create new schema with `users`, `sessions`, `user_config`, and all existing tables with `user_id` columns. Keep `PRAGMA foreign_keys=ON` and `journal_mode=WAL`.
- All query methods gain `user_id` parameter: `get_all_accounts(user_id)`, `insert_post(user_id, ...)`, `get_new_posts_since(user_id, since)`, etc.
- New methods: `insert_user()`, `get_user_by_email()`, `get_user_by_id()`, `insert_session()`, `get_session()` (filters expired), `delete_expired_sessions()`, `set_user_config()`, `get_user_config()`, `get_all_active_users()`, `deactivate_user()`.
- Remove old `get_config()` / `set_config()` methods.
- `get_all_active_users()`: returns users WHERE `is_active=1` AND they have `ig_cookies` in `user_config`.
- `upsert_fb_group(user_id, group_id, name, url)`: PK is `(user_id, group_id)`.
- `upsert_account(user_id, username, profile_pic_path)`: PK is `(user_id, username)`.

Schema SQL for `initialize()`:

```sql
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    is_admin BOOLEAN DEFAULT 0,
    is_active BOOLEAN DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS user_config (
    user_id INTEGER NOT NULL REFERENCES users(id),
    key TEXT NOT NULL,
    value TEXT,
    PRIMARY KEY (user_id, key)
);

CREATE TABLE IF NOT EXISTS accounts (
    user_id INTEGER NOT NULL REFERENCES users(id),
    username TEXT NOT NULL,
    profile_pic_path TEXT,
    last_checked_at DATETIME,
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, username)
);

CREATE TABLE IF NOT EXISTS posts (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    username TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('post','reel','story')),
    caption TEXT,
    timestamp DATETIME,
    permalink TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS media (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id TEXT NOT NULL REFERENCES posts(id),
    media_type TEXT NOT NULL CHECK(media_type IN ('image','video')),
    file_path TEXT NOT NULL,
    thumbnail_path TEXT,
    "order" INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS scrape_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    finished_at DATETIME,
    status TEXT,
    new_posts_count INTEGER DEFAULT 0,
    new_stories_count INTEGER DEFAULT 0,
    error TEXT,
    log TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS manual_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    since_date TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    new_posts_count INTEGER DEFAULT 0,
    new_stories_count INTEGER DEFAULT 0,
    error TEXT,
    log TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    started_at DATETIME,
    finished_at DATETIME
);

CREATE TABLE IF NOT EXISTS fb_groups (
    user_id INTEGER NOT NULL REFERENCES users(id),
    group_id TEXT NOT NULL,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    last_checked_at DATETIME,
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, group_id)
);

CREATE TABLE IF NOT EXISTS fb_posts (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL,
    author_name TEXT,
    content TEXT,
    timestamp DATETIME,
    permalink TEXT,
    comment_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS fb_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id TEXT NOT NULL REFERENCES fb_posts(id),
    author_name TEXT,
    content TEXT,
    timestamp DATETIME,
    "order" INTEGER DEFAULT 0
);
```

Note: `fb_posts` doesn't need `user_id` directly since it references `group_id` which is user-scoped. But queries for user's FB posts should JOIN through `fb_groups`. Same for `fb_comments` through `fb_posts`.

**Step 4: Run tests to verify they pass**

Run: `cd /home/niec/Documents/repos/ig-sub/scraper && python -m pytest tests/test_db.py -v`
Expected: ALL PASS

**Step 5: Update remaining scraper tests**

Update `test_cookies.py`, `test_scrape.py`, `test_digest.py`, `test_instagram.py` to work with the new user-scoped DB methods. Tests that create posts/accounts now need to create a user first and pass `user_id`.

**Step 6: Run full test suite**

Run: `cd /home/niec/Documents/repos/ig-sub/scraper && python -m pytest -v`
Expected: ALL PASS

**Step 7: Commit**

```bash
git add scraper/src/db.py scraper/tests/
git commit -m "feat: rewrite database schema for multi-user support"
```

---

### Task 2: Scraper — User-Scoped Cookies & Config

Update the cookie manager and scraper to work per-user.

**Files:**
- Modify: `scraper/src/cookies.py` (accept `user_id`, use `user_config` table)
- Modify: `scraper/src/scrape.py` (pass `user_id` through all operations)
- Modify: `scraper/tests/test_cookies.py`
- Modify: `scraper/tests/test_scrape.py`

**Step 1: Write failing tests**

Update `test_cookies.py` — `CookieManager` methods now take `user_id`:
```python
def test_store_and_retrieve_cookies(db):
    user_id = db.insert_user("a@b.com", "hash")
    mgr = CookieManager(db, ENCRYPTION_KEY)
    mgr.store_cookies(user_id, {"sessionid": "abc", "csrftoken": "xyz"})
    cookies = mgr.get_cookies(user_id)
    assert cookies["sessionid"] == "abc"

def test_mark_stale(db):
    user_id = db.insert_user("a@b.com", "hash")
    mgr = CookieManager(db, ENCRYPTION_KEY)
    mgr.store_cookies(user_id, {"sessionid": "abc"})
    mgr.mark_stale(user_id)
    assert db.get_user_config(user_id, "ig_cookies_stale") == "true"
```

Update `test_scrape.py` — `Scraper` methods use `user_id`:
```python
def test_scrape_all_scoped(db, ...):
    user_id = db.insert_user("a@b.com", "hash")
    db.upsert_account(user_id, "testuser", None)
    scraper = Scraper(db=db, ig_client=mock_ig, downloader=mock_dl, user_id=user_id)
    posts, stories = scraper.scrape_all()
    # verify posts saved with correct user_id
```

**Step 2: Run tests to verify they fail**

Run: `cd /home/niec/Documents/repos/ig-sub/scraper && python -m pytest tests/test_cookies.py tests/test_scrape.py -v`
Expected: FAIL

**Step 3: Update `cookies.py`**

- `CookieManager.__init__(self, db, encryption_key)` — same as before
- `store_cookies(self, user_id, cookies)` — encrypt and store in `user_config` via `db.set_user_config(user_id, "ig_cookies", encrypted)`
- `get_cookies(self, user_id)` — read from `db.get_user_config(user_id, "ig_cookies")`, decrypt, return dict
- `mark_stale(self, user_id)` — `db.set_user_config(user_id, "ig_cookies_stale", "true")`
- Same pattern for FB cookies: `store_fb_cookies(user_id, ...)`, `get_fb_cookies(user_id)`, `mark_fb_stale(user_id)`

**Step 4: Update `scrape.py`**

- `Scraper.__init__(self, db, ig_client, downloader, user_id, fb_client=None)` — store `self.user_id`
- All `self.db.*` calls now pass `self.user_id`
- `scrape_all()`: `self.db.get_all_accounts(self.user_id)`, `self._process_post()` passes `self.user_id`
- `_process_post()`: `self.db.insert_post(user_id=self.user_id, ...)`
- `scrape_fb_group()`: `self.db.insert_fb_post(...)` (no user_id needed, scoped through group)
- `scrape_all_fb_groups()`: `self.db.get_all_fb_groups(self.user_id)`

**Step 5: Run tests**

Run: `cd /home/niec/Documents/repos/ig-sub/scraper && python -m pytest -v`
Expected: ALL PASS

**Step 6: Commit**

```bash
git add scraper/src/cookies.py scraper/src/scrape.py scraper/tests/
git commit -m "feat: scope cookies and scraper operations by user_id"
```

---

### Task 3: Scraper — Per-User Scheduling

Replace the single-cron scheduler with a polling loop that checks which users are due.

**Files:**
- Modify: `scraper/src/main.py` (rewrite `main()` and `run_scrape()`)
- Modify: `scraper/src/db.py` (add `get_last_scrape_time(user_id)`)

**Step 1: Add DB helper + test**

Add to `test_db.py`:
```python
def test_get_last_scrape_time(db):
    u = db.insert_user("a@b.com", "hash")
    assert db.get_last_scrape_time(u) is None
    run_id = db.insert_scrape_run(u)
    db.finish_scrape_run(run_id, "success", 0, 0)
    assert db.get_last_scrape_time(u) is not None
```

Add to `db.py`:
```python
def get_last_scrape_time(self, user_id: int) -> str | None:
    row = self._conn.execute(
        "SELECT MAX(started_at) as last FROM scrape_runs WHERE user_id=? AND status='success'",
        (user_id,)
    ).fetchone()
    return row["last"] if row and row["last"] else None
```

**Step 2: Rewrite `main.py`**

Key changes:

- `run_user_scrape(user_id)`: replaces `run_scrape()`. Loads user's cookies via `CookieManager.get_cookies(user_id)`, creates `InstagramClient`, creates `Scraper(db, ig, downloader, user_id)`, runs `scraper.scrape_all()`, checks DMs, handles FB scraping if user has FB cookies, sends per-user digest.

- `check_due_scrapes()`: new function that runs every 60 seconds. For each active user (`db.get_all_active_users()`): read their `cron_schedule` from `user_config` (default `"0 8 * * *"`), compare against `db.get_last_scrape_time(user_id)` using `croniter` to check if a scrape is due. If due, call `run_user_scrape(user_id)`.

- Polling jobs become user-scoped: `check_cookie_test()` iterates users checking for `user_config` key `"cookie_test"` = `"pending"`. Same for `check_manual_runs()`, `check_trigger_scrape()`, etc.

- `main()` scheduler simplified:
  - `check_due_scrapes` every 60s
  - `check_user_cookie_tests` every 10s
  - `check_user_manual_runs` every 30s
  - `check_user_triggers` every 10s

**Step 3: Run full test suite**

Run: `cd /home/niec/Documents/repos/ig-sub/scraper && python -m pytest -v`
Expected: ALL PASS

**Step 4: Commit**

```bash
git add scraper/src/main.py scraper/src/db.py scraper/tests/
git commit -m "feat: per-user scrape scheduling with cron polling"
```

---

### Task 4: Web — Auth Backend

Add Argon2 password hashing, user creation, and session management to the Next.js app.

**Files:**
- Modify: `web/package.json` (add `argon2` dependency)
- Rewrite: `web/src/lib/auth.ts` (Argon2 hashing, session DB operations)
- Modify: `web/src/lib/db.ts` (add user/session query functions, scope all queries by user_id)
- Rewrite: `web/src/app/api/auth/route.ts` (email+password login + signup)

**Step 1: Install argon2**

Run: `cd /home/niec/Documents/repos/ig-sub/web && npm install argon2`

Note: `argon2` npm package uses native bindings. The Dockerfile may need `build-essential` or `python3` for compilation, but `node:20-alpine` usually handles this. If build fails, add `RUN apk add --no-cache python3 make g++` before `npm ci` in `web/Dockerfile`.

**Step 2: Rewrite `auth.ts`**

```typescript
import argon2 from "argon2";
import { randomBytes } from "crypto";
import { cookies } from "next/headers";
import { getWritableDb, getDb } from "./db";

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  return argon2.verify(hash, password);
}

export function createSessionToken(): string {
  return randomBytes(32).toString("hex");
}

export async function getCurrentUserId(): Promise<number | null> {
  const cookieStore = await cookies();
  const session = cookieStore.get("ig_session");
  if (!session?.value || !/^[a-f0-9]{64}$/.test(session.value)) return null;

  const db = getDb();
  const row = db.prepare(
    "SELECT user_id FROM sessions WHERE token = ? AND expires_at > datetime('now')"
  ).get(session.value) as { user_id: number } | undefined;
  return row?.user_id ?? null;
}

// Helper that throws if not authenticated — use in API routes
export async function requireUserId(): Promise<number> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Unauthorized");
  return userId;
}
```

**Step 3: Add user/session functions to `db.ts`**

Add to `db.ts`:

```typescript
export function createUser(email: string, passwordHash: string): number {
  const db = getWritableDb();
  const result = db.prepare(
    "INSERT INTO users (email, password_hash) VALUES (?, ?)"
  ).run(email, passwordHash);
  db.close();
  return Number(result.lastInsertRowid);
}

export function getUserByEmail(email: string): { id: number; email: string; password_hash: string; is_admin: boolean; is_active: boolean } | undefined {
  return getDb().prepare("SELECT * FROM users WHERE email = ?").get(email) as any;
}

export function insertSession(token: string, userId: number, expiresAt: string): void {
  const db = getWritableDb();
  db.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)").run(token, userId, expiresAt);
  db.close();
}

export function deleteSession(token: string): void {
  const db = getWritableDb();
  db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
  db.close();
}
```

Update all existing query functions to accept and use `userId` parameter. For example:

```typescript
export function getUnifiedFeed(userId: number, limit = 20, offset = 0, ...): UnifiedFeedItem[] {
  // Add "p.user_id = ?" to IG query WHERE clause
  // JOIN fb_groups with user_id filter for FB query
}

export function getAccounts(userId: number): Account[] {
  return getDb().prepare("SELECT * FROM accounts WHERE user_id = ? ORDER BY username").all(userId) as Account[];
}
```

Replace `getConfig`/`setConfig` with user-scoped versions:

```typescript
export function getUserConfig(userId: number, key: string): string | null {
  const row = getDb().prepare("SELECT value FROM user_config WHERE user_id = ? AND key = ?").get(userId, key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setUserConfig(userId: number, key: string, value: string): void {
  const db = getWritableDb();
  db.prepare("INSERT INTO user_config (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET value=excluded.value").run(userId, key, value);
  db.close();
}
```

**Step 4: Rewrite auth API route**

`web/src/app/api/auth/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { hashPassword, verifyPassword, createSessionToken } from "@/lib/auth";
import { getUserByEmail, createUser, insertSession } from "@/lib/db";

// POST /api/auth — login
export async function POST(request: NextRequest) {
  const { email, password, action } = await request.json();

  if (action === "signup") {
    if (!email || !password) {
      return NextResponse.json({ error: "Email and password required" }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
    }
    const existing = getUserByEmail(email);
    if (existing) {
      return NextResponse.json({ error: "Email already registered" }, { status: 409 });
    }
    const hash = await hashPassword(password);
    const userId = createUser(email, hash);
    const token = createSessionToken();
    const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    insertSession(token, userId, expires);

    const response = NextResponse.json({ ok: true });
    response.cookies.set("ig_session", token, {
      httpOnly: true, secure: true, sameSite: "lax",
      maxAge: 60 * 60 * 24 * 30, path: "/",
    });
    return response;
  }

  // Default: login
  const user = getUserByEmail(email);
  if (!user || !user.is_active) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }
  const valid = await verifyPassword(user.password_hash, password);
  if (!valid) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const token = createSessionToken();
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  insertSession(token, user.id, expires);

  const response = NextResponse.json({ ok: true });
  response.cookies.set("ig_session", token, {
    httpOnly: true, secure: true, sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30, path: "/",
  });
  return response;
}
```

**Step 5: Build and verify no type errors**

Run: `cd /home/niec/Documents/repos/ig-sub/web && npm run build`
Expected: Build succeeds

**Step 6: Commit**

```bash
git add web/
git commit -m "feat: add Argon2 auth with user signup/login and session management"
```

---

### Task 5: Web — Middleware & User-Scoped API Routes

Update middleware to resolve `user_id` from session, then scope all API routes.

**Files:**
- Modify: `web/src/middleware.ts` (add `/signup` to public routes, validate session against DB)
- Modify: `web/src/app/api/feed/route.ts` (scope by user_id)
- Modify: `web/src/app/api/settings/route.ts` (use user_config)
- Modify: `web/src/app/api/extension/cookies/route.ts` (scope by user)
- Modify: `web/src/app/api/extension/fb-cookies/route.ts` (scope by user)
- Modify: any other API routes that read/write data

**Step 1: Update middleware**

Add `/signup` to public routes in `middleware.ts`:

```typescript
const isPublicPage = request.nextUrl.pathname === "/login"
  || request.nextUrl.pathname === "/signup"
  || request.nextUrl.pathname === "/";
const isPublicApi = request.nextUrl.pathname === "/api/auth"
  || request.nextUrl.pathname.startsWith("/api/extension/");
```

Note: Middleware can't do async DB lookups in Next.js edge runtime. Keep middleware as a token-format check only. The actual session-to-user resolution happens in `getCurrentUserId()` called by each API route.

**Step 2: Update feed route**

```typescript
import { requireUserId } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const userId = await requireUserId();
  // ... pass userId to getUnifiedFeed(userId, limit, offset, ...)
}
```

**Step 3: Update settings route**

```typescript
import { requireUserId } from "@/lib/auth";
import { getUserConfig, setUserConfig } from "@/lib/db";

export async function GET() {
  const userId = await requireUserId();
  const hasCookies = getUserConfig(userId, "ig_cookies") !== null;
  const cookieStatus = getUserConfig(userId, "ig_cookies_stale");
  const cronSchedule = getUserConfig(userId, "cron_schedule") || "0 8 * * *";
  const emailRecipient = getUserConfig(userId, "email_recipient") || "";
  // ...
}

export async function POST(request: NextRequest) {
  const userId = await requireUserId();
  // ... use setUserConfig(userId, key, value) instead of setConfig()
}
```

**Step 4: Update extension cookie routes**

The extension currently authenticates with the admin password. For multi-user, each user needs their own way to auth the extension. Add an API key per user:

- When a user is created, generate an API key (`randomBytes(16).toString("hex")`) stored in `user_config` as `"api_key"`.
- Extension sends `api_key` instead of `password`.
- Route looks up user by API key: `SELECT user_id FROM user_config WHERE key='api_key' AND value=?`.
- Display the API key on the settings page so users can paste it into the extension.

Update `web/src/app/api/extension/cookies/route.ts`:
```typescript
export async function POST(request: NextRequest) {
  const { api_key, cookies } = await request.json();
  const userId = getUserIdByApiKey(api_key);
  if (!userId) {
    return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
  }
  // ... encrypt and store in user_config for this userId
}
```

Add `getUserIdByApiKey` to `db.ts`:
```typescript
export function getUserIdByApiKey(apiKey: string): number | null {
  const row = getDb().prepare(
    "SELECT user_id FROM user_config WHERE key = 'api_key' AND value = ?"
  ).get(apiKey) as { user_id: number } | undefined;
  return row?.user_id ?? null;
}
```

**Step 5: Update remaining API routes**

Check all routes under `web/src/app/api/` and add `requireUserId()` + user scoping:
- `/api/fb-groups` (GET, POST, DELETE)
- `/api/cookies/test` and `/api/cookies/fb-test`
- Any other routes

**Step 6: Build and verify**

Run: `cd /home/niec/Documents/repos/ig-sub/web && npm run build`
Expected: Build succeeds

**Step 7: Commit**

```bash
git add web/
git commit -m "feat: scope all API routes by authenticated user_id"
```

---

### Task 6: Web — Login & Signup Pages

Create the signup page and update the login page for email+password.

**Files:**
- Modify: `web/src/app/login/page.tsx` (email + password)
- Create: `web/src/app/signup/page.tsx` (email + password + trust disclaimer)

**Step 1: Update login page**

Replace password-only form with email + password form. Add "Don't have an account? Sign up" link below the form.

```tsx
// Key changes:
const [email, setEmail] = useState("");
// ...
body: JSON.stringify({ email, password }),
// Add email Input field before password field
// Add link: <a href="/signup">Sign up</a>
```

**Step 2: Create signup page**

`web/src/app/signup/page.tsx`:

Trust disclaimer section before the form explaining:
- This service uses your Instagram session cookies to fetch your feed on your behalf
- We recommend using a secondary/throwaway Instagram account
- This tool is only for viewing content from public accounts
- The server operator can technically act as you on Instagram
- Link to GitHub source code

Checkbox: "I understand and accept these terms"

Form: email, password, confirm password. Submit calls `POST /api/auth` with `action: "signup"`.

Only enable submit when checkbox is checked and passwords match.

After successful signup, redirect to `/settings`.

**Step 3: Build and verify**

Run: `cd /home/niec/Documents/repos/ig-sub/web && npm run build`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add web/src/app/login/ web/src/app/signup/
git commit -m "feat: add email+password login and signup with trust disclaimer"
```

---

### Task 7: Web — Landing Page

Create the public landing page at `/` that explains the service. Authenticated users get redirected to their feed.

**Files:**
- Modify: `web/src/app/page.tsx` (conditional: landing page or feed)
- Create: `web/src/app/(app)/page.tsx` (move feed here for authenticated users)

Actually, simpler approach: use a route group.

- Create: `web/src/app/(public)/page.tsx` — landing page (always accessible)
- Move current feed to: `web/src/app/(app)/feed/page.tsx` or keep at `/feed`
- In the landing page component, check auth: if authenticated, redirect to `/feed`

Alternative (simpler): Keep `/` as the landing page. Redirect authenticated users to `/feed`. Move the current home page to `/feed`.

**Step 1: Move current feed page**

- Move `web/src/app/page.tsx` to `web/src/app/feed/page.tsx`
- Update any internal links that point to `/` to point to `/feed`

**Step 2: Create landing page at `/`**

`web/src/app/page.tsx`:

Server component that checks auth. If authenticated, redirect to `/feed`. Otherwise, render the landing page.

Landing page content (monospace aesthetic matching digest emails):
- Gradient bar at top (matching email: `#FEDA77 → #DD2A7B → #515BD4`)
- "low-scroll" logo + title
- Tagline: "Your Instagram feed, delivered as a daily email digest"
- How it works: 3 steps with icons
  1. Create an account and install the browser extension
  2. The extension syncs your Instagram cookies securely
  3. Get a daily email digest with posts and stories from accounts you follow
- Trust & transparency section:
  - "This service acts on your behalf on Instagram using your session cookies"
  - "We recommend using a secondary account you're comfortable with"
  - "Only intended for viewing content from public accounts"
  - "Fully open source" — link to GitHub repo
- CTA buttons: "Sign up" and "Log in"
- Footer: "Built with low-scroll" link to GitHub

Style: Use `font-family: 'Courier New', Courier, monospace` throughout. Colors matching the digest email aesthetic. Keep it minimal.

**Step 3: Update middleware for new routes**

Ensure `/feed` is protected (requires auth) and `/` is public.

**Step 4: Update navigation links**

Update any component that links to `/` (e.g., settings "back" links) to link to `/feed` instead.

**Step 5: Build and verify**

Run: `cd /home/niec/Documents/repos/ig-sub/web && npm run build`
Expected: Build succeeds

**Step 6: Commit**

```bash
git add web/src/app/
git commit -m "feat: add landing page with trust disclosure, move feed to /feed"
```

---

### Task 8: Web — Admin Page

Add a simple admin page for user management.

**Files:**
- Create: `web/src/app/admin/page.tsx`
- Create: `web/src/app/api/admin/users/route.ts`
- Modify: `web/src/lib/db.ts` (add admin query functions)

**Step 1: Add DB functions**

```typescript
export function getAllUsers(): { id: number; email: string; is_admin: boolean; is_active: boolean; created_at: string }[] {
  return getDb().prepare("SELECT id, email, is_admin, is_active, created_at FROM users ORDER BY created_at DESC").all() as any[];
}

export function setUserActive(userId: number, active: boolean): void {
  const db = getWritableDb();
  db.prepare("UPDATE users SET is_active = ? WHERE id = ?").run(active ? 1 : 0, userId);
  db.close();
}

export function isUserAdmin(userId: number): boolean {
  const row = getDb().prepare("SELECT is_admin FROM users WHERE id = ?").get(userId) as { is_admin: number } | undefined;
  return row?.is_admin === 1;
}
```

**Step 2: Create admin API route**

`web/src/app/api/admin/users/route.ts`:

```typescript
import { requireUserId } from "@/lib/auth";
import { isUserAdmin, getAllUsers, setUserActive } from "@/lib/db";

export async function GET() {
  const userId = await requireUserId();
  if (!isUserAdmin(userId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return NextResponse.json({ users: getAllUsers() });
}

export async function PATCH(request: NextRequest) {
  const userId = await requireUserId();
  if (!isUserAdmin(userId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { targetUserId, is_active } = await request.json();
  setUserActive(targetUserId, is_active);
  return NextResponse.json({ ok: true });
}
```

**Step 3: Create admin page**

Simple table listing users with email, created date, status, and activate/deactivate toggle. Gate with admin check — if not admin, show "Access denied".

**Step 4: Build and verify**

Run: `cd /home/niec/Documents/repos/ig-sub/web && npm run build`
Expected: Build succeeds

**Step 5: Commit**

```bash
git add web/src/app/admin/ web/src/app/api/admin/ web/src/lib/db.ts
git commit -m "feat: add admin page for user management"
```

---

### Task 9: Settings Page & Extension Updates

Update the settings form to show the API key for the extension and work with user-scoped config.

**Files:**
- Modify: `web/src/components/settings-form.tsx` (show API key, update fetch calls)
- Modify: `web/src/app/api/settings/route.ts` (return API key in GET)

**Step 1: Add API key to settings response**

In `GET /api/settings`, include the user's API key:
```typescript
const apiKey = getUserConfig(userId, "api_key");
// If no API key exists yet, generate one
if (!apiKey) {
  const newKey = randomBytes(16).toString("hex");
  setUserConfig(userId, "api_key", newKey);
}
return NextResponse.json({ ..., apiKey: getUserConfig(userId, "api_key") });
```

**Step 2: Update settings form**

Add a section at the top of the settings form showing the API key with a copy button:

```tsx
<Card>
  <CardHeader>
    <CardTitle>Browser Extension</CardTitle>
  </CardHeader>
  <CardContent>
    <p className="text-sm text-muted-foreground mb-2">
      Use this API key in the Chrome extension to sync your cookies automatically.
    </p>
    <div className="flex gap-2">
      <Input value={settings.apiKey} readOnly />
      <Button variant="outline" onClick={() => navigator.clipboard.writeText(settings.apiKey)}>
        Copy
      </Button>
    </div>
  </CardContent>
</Card>
```

**Step 3: Build and verify**

Run: `cd /home/niec/Documents/repos/ig-sub/web && npm run build`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add web/
git commit -m "feat: show API key in settings for extension authentication"
```

---

### Task 10: Docker & Deployment Updates

Update Dockerfiles and docker-compose for the new dependencies and schema.

**Files:**
- Modify: `web/Dockerfile` (ensure argon2 native build works)
- Modify: `docker-compose.yml` (remove single-user env vars that are no longer needed)
- Modify: `.env.example` (update for multi-user)

**Step 1: Update web Dockerfile**

If `argon2` npm package fails to build on alpine, add build dependencies:
```dockerfile
RUN apk add --no-cache python3 make g++
```
before the `npm ci` step. Test by building locally first.

**Step 2: Update docker-compose.yml**

Remove env vars that are now per-user (stored in user_config instead):
- Remove `EMAIL_RECIPIENT` from scraper service
- Remove `CRON_SCHEDULE` from scraper service
- Remove `ADMIN_PASSWORD` from web service
- Keep: `DATABASE_PATH`, `MEDIA_PATH`, `ENCRYPTION_KEY`, `RESEND_API_KEY`, `BASE_URL`

**Step 3: Update .env.example**

```
ENCRYPTION_KEY=generate-a-32-byte-hex-key
RESEND_API_KEY=re_xxxxx
BASE_URL=https://your-domain.com
```

**Step 4: Test Docker build locally**

Run: `docker compose build`
Expected: Both images build successfully

**Step 5: Commit**

```bash
git add Dockerfile docker-compose.yml .env.example
git commit -m "chore: update Docker config for multi-user support"
```

---

### Task 11: Seed Admin User & Final Integration Test

Create the first admin user and do a full end-to-end test.

**Step 1: Create a seed script**

Create `scraper/seed_admin.py`:

```python
"""One-time script to create the initial admin user."""
import sys
import subprocess
from src.config import Config
from src.db import Database

def main():
    if len(sys.argv) != 3:
        print("Usage: python -m seed_admin <email> <password>")
        sys.exit(1)
    email, password = sys.argv[1], sys.argv[2]

    # Hash password with argon2 CLI or library
    try:
        import argon2
        ph = argon2.PasswordHasher()
        password_hash = ph.hash(password)
    except ImportError:
        print("Install argon2-cffi: pip install argon2-cffi")
        sys.exit(1)

    config = Config()
    db = Database(config.DATABASE_PATH)
    db.initialize()
    user_id = db.insert_user(email, password_hash)
    # Mark as admin
    db._conn.execute("UPDATE users SET is_admin=1 WHERE id=?", (user_id,))
    db._conn.commit()
    print(f"Admin user created: {email} (id={user_id})")
    db.close()

if __name__ == "__main__":
    main()
```

Add `argon2-cffi` to `scraper/requirements.txt` (for the seed script only).

**Step 2: Run full test suites**

```bash
cd /home/niec/Documents/repos/ig-sub/scraper && python -m pytest -v
cd /home/niec/Documents/repos/ig-sub/web && npm run build
```

**Step 3: Test end-to-end locally**

```bash
docker compose up -d --build
# Create admin user
docker compose exec scraper python -m seed_admin your@email.com yourpassword
# Visit https://localhost — should see landing page
# Sign up as a new user
# Log in, configure cookies, verify feed works
```

**Step 4: Commit**

```bash
git add scraper/seed_admin.py scraper/requirements.txt
git commit -m "feat: add admin seed script for initial setup"
```

**Step 5: Deploy**

```bash
bash deploy.sh
# SSH into server and run seed script for your admin account
ssh ig-sub "cd /opt/ig-sub && docker compose exec scraper python -m seed_admin your@email.com yourpassword"
```
