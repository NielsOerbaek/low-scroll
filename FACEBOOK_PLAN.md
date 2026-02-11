# Facebook Group Digests — Design Document

## Problem

low-scroll currently only handles Instagram. I also want digests of Facebook groups I'm in — new posts, top comments, comment counts, with links back into Facebook.

## Background Research

### Why not the Graph API?

Meta **completely deprecated** third-party Facebook Groups API access in April 2024. The `publish_to_groups` and `groups_access_member_info` permissions are gone. The only official alternative is the Content Library API, which is restricted to approved academic/non-profit researchers.

**The only viable approach is cookie-authenticated HTML scraping of mbasic.facebook.com.**

### mbasic.facebook.com

Facebook's lightweight mobile interface — server-rendered HTML, no JavaScript required. Advantages:
- Simple HTTP requests + BeautifulSoup parsing (no headless browser needed)
- Clean, predictable DOM structure
- Works with standard cookies from a logged-in Facebook session

### Required cookies

Two essential cookies from `.facebook.com`:
- `c_user` — user ID (365 day lifetime)
- `xs` — session secret (365 day lifetime, HttpOnly)

Additional useful cookies: `fr`, `datr`, `sb`

### Risks

- **Detection**: Facebook is stricter than Instagram about bot detection. Need 5-10s delays between requests minimum.
- **Fragility**: mbasic HTML structure can change without notice. Parser needs to be isolated and well-logged.
- **Account risk**: Automated access violates Facebook ToS. Account could be flagged.
- **Rate**: For 3 groups × ~10 posts each, fetching comments means ~33 requests at ~7.5s avg = ~4 minutes per scrape run. Acceptable.

---

## Architecture Decisions

### Unified feed, not separate

Facebook posts appear in the same chronological feed as Instagram posts, tagged with platform. One place to check.

### Parallel DB tables, unified at query time

Don't force Facebook data into Instagram-shaped tables. Create `fb_groups`, `fb_posts`, `fb_comments` tables, then use SQL UNION for the feed query. Avoids ID collisions, schema migrations, and keeps code cleanly separated.

### Extension handles both platforms

Extend the existing Chrome extension with a Facebook section. Add `https://*.facebook.com/*` to host_permissions. Separate "Sync FB Cookies" button.

### Groups configured manually

1-3 groups added by URL on the settings page. No auto-discovery needed.

---

## Database Schema

### New tables (in `scraper/src/db.py`)

```sql
CREATE TABLE IF NOT EXISTS fb_groups (
    group_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    last_checked_at DATETIME,
    added_at DATETIME DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS fb_posts (
    id TEXT PRIMARY KEY,              -- prefixed "fb_" to avoid collision with IG post IDs
    group_id TEXT NOT NULL REFERENCES fb_groups(group_id),
    author_name TEXT,
    content TEXT,
    timestamp DATETIME,
    permalink TEXT,                    -- https://www.facebook.com/groups/{id}/posts/{story_fbid}
    comment_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS fb_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id TEXT NOT NULL REFERENCES fb_posts(id),
    author_name TEXT,
    content TEXT,
    timestamp DATETIME,
    "order" INTEGER DEFAULT 0         -- top 2-3 comments per post
);
```

### Unified feed query

```sql
SELECT id, username as source_name, type, caption as content, timestamp, permalink,
       'instagram' as platform, NULL as comment_count
FROM posts
UNION ALL
SELECT id, g.name as source_name, 'fb_post' as type, content, timestamp, permalink,
       'facebook' as platform, comment_count
FROM fb_posts p JOIN fb_groups g ON p.group_id = g.group_id
ORDER BY timestamp DESC
LIMIT ? OFFSET ?
```

### New db.py methods

- `upsert_fb_group(group_id, name, url)`
- `get_all_fb_groups()`, `get_fb_group(group_id)`
- `update_fb_group_last_checked(group_id)`
- `insert_fb_post(...)` — returns bool (was new)
- `get_fb_post(post_id)`
- `insert_fb_comment(post_id, author_name, content, timestamp, order)`
- `get_comments_for_post(post_id)`
- `get_unified_feed(limit, offset, account?, group_id?, type?, platform?)`
- `get_new_fb_posts_since(since)`

---

## Facebook Client (`scraper/src/facebook.py`)

New file, following `instagram.py` patterns:

```python
class FacebookClient:
    def __init__(self, cookies: dict[str, str]):
        # curl_cffi session with Chrome impersonation
        # Set cookies on .facebook.com domain
        # Key cookies: c_user, xs, fr, datr, sb

    def _get(self, url: str) -> str:
        # Returns raw HTML (not JSON)
        # 5-10s random delay before each request
        # 3 retries with backoff on rate limits
        # Returns response.text

    def validate_session(self) -> bool | None:
        # GET mbasic.facebook.com, check if redirected to login

    def get_group_posts(self, group_id: str, limit: int = 10) -> list[dict]:
        # GET mbasic.facebook.com/groups/{group_id}
        # Parse HTML with BeautifulSoup
        # Returns: [{id, author_name, content, timestamp, permalink, comment_count, comments}]

    def get_group_name(self, group_id: str) -> str:
        # Parse from group page HTML

    @staticmethod
    def random_delay(min_s=5.0, max_s=10.0):
        time.sleep(random.uniform(min_s, max_s))
```

### mbasic parsing notes

- Posts: `<div>` elements in main content area, often with `data-ft` attributes
- Author: `<a>` tag in `<h3>` or `<strong>` at top of each post
- Text: `<div>` following author header
- Timestamp: `<abbr data-utime="...">` or relative text ("2 hrs", "Yesterday")
- Comment count: link text like "12 Comments"
- Post ID: extract `story_fbid` from permalink URL
- Top comments: requires a separate request per post (loading the individual post page)

### Comment fetching cost

For 3 groups with ~10 posts each, fetching comments = 30 extra requests at 5-10s each = 2.5-5 minutes just for comments. Consider making comment fetching optional or only fetching for posts with >0 comments.

### New dependency

`beautifulsoup4>=4.12.0` and `lxml>=5.0.0` in `scraper/requirements.txt`

---

## Scraper Integration

### scrape.py changes

Add to `Scraper.__init__`: optional `fb_client` param.

New methods:
- `scrape_fb_group(group_id) -> int` — fetch posts, insert new ones + comments, return count
- `scrape_all_fb_groups() -> int` — loop all groups with 15-45s delays between

Keep `scrape_all()` unchanged (Instagram only). Add separate `scrape_all_fb()`.

### main.py changes

In `run_scrape()`, after Instagram scraping:
1. Load FB cookies (config key `fb_cookies`)
2. If present: create `FacebookClient`, validate session, call `scrape_all_fb_groups()`
3. Build unified digest with both IG and FB posts

Add `check_fb_cookie_test()` on 10-second interval (same pattern as IG cookie test).

---

## Cookie Management

### cookies.py additions

```python
def store_fb_cookies(self, cookies): ...   # encrypt to config "fb_cookies"
def get_fb_cookies(self) -> dict | None: ... # decrypt from config "fb_cookies"
def mark_fb_stale(self): ...
def is_fb_stale(self) -> bool: ...
```

Same encryption key, different config keys.

---

## Chrome Extension

### manifest.json

Add `"https://*.facebook.com/*"` to `host_permissions`.

### popup.html + popup.js

Add a second section below Instagram:
- "Facebook Cookies" heading
- Key cookie display: `c_user`, `xs`, `fr`, `datr`, `sb` + total count
- Separate "Sync FB Cookies" button
- Calls `chrome.cookies.getAll({ domain: ".facebook.com" })`
- POSTs to `/api/extension/fb-cookies`

---

## Web API Routes

### New routes

| Route | Method | Purpose |
|---|---|---|
| `/api/extension/fb-cookies` | POST | Extension syncs FB cookies |
| `/api/cookies/fb-test` | POST/GET | Trigger + poll FB cookie validation |
| `/api/fb-groups` | GET/POST/DELETE | CRUD for configured FB groups |

### Modified routes

| Route | Change |
|---|---|
| `/api/feed` | Switch to unified feed query, enrich FB posts with comments |
| `/api/settings` GET | Include `hasFbCookies`, `fbCookiesStale`, `fbGroups` |

---

## Web Frontend

### feed.tsx

Add "Facebook" tab:
```
All | Posts | Stories | Facebook
```
When selected, pass `type=fb_post` to API.

### post-card.tsx

Extend to handle `fb_post` type:
- Header: group name + "fb" badge + author name
- Body: post text (no media)
- Comments: top 2-3 inline with author names
- Footer: comment count + "View on Facebook →" link

### settings-form.tsx

Two new Card sections:
1. **Facebook Cookies** — status badge, test button, same pattern as IG cookies
2. **Facebook Groups** — list with remove buttons, URL input + add button, max 3

### New page: `/fb-post/[id]/page.tsx`

Detail view for a Facebook post — full text, all stored comments, link to original.

---

## Digest Email

### digest.html

Add Facebook section after Instagram, with blue accent (#1877f2):
- Author name + group name
- Post text (first 300 chars)
- Top 2-3 comments inline
- Comment count + "View on Facebook →"

### digest.py

- `build_html(ig_posts, fb_posts=[])` — accepts both lists
- Subject line: "low-scroll digest: 5 IG + 3 FB new"

---

## Implementation Order

1. DB schema + methods (`db.py`)
2. Facebook client (`facebook.py`) — test standalone against mbasic
3. Cookie management (`cookies.py`)
4. Scraper integration (`scrape.py`)
5. Main loop (`main.py`)
6. Chrome extension (`manifest.json`, `popup.html`, `popup.js`)
7. Web API routes (new + modified)
8. Web DB layer (`db.ts`)
9. Feed + PostCard UI
10. Settings UI
11. Digest email template + builder
12. Requirements (`requirements.txt`)

---

## Files Summary

### Create
- `scraper/src/facebook.py` — FacebookClient
- `web/src/app/api/extension/fb-cookies/route.ts`
- `web/src/app/api/cookies/fb-test/route.ts`
- `web/src/app/api/fb-groups/route.ts`
- `web/src/app/fb-post/[id]/page.tsx`

### Modify
- `scraper/src/db.py` — new tables, methods, unified query
- `scraper/src/scrape.py` — fb_client, scrape_fb_group, scrape_all_fb_groups
- `scraper/src/main.py` — FB in cron job, FB cookie test polling
- `scraper/src/cookies.py` — FB cookie methods
- `scraper/src/digest.py` — accept FB posts, update subject
- `scraper/templates/digest.html` — FB posts section
- `scraper/requirements.txt` — add beautifulsoup4, lxml
- `web/src/lib/db.ts` — interfaces, unified feed, FB queries
- `web/src/app/api/feed/route.ts` — unified feed + comment enrichment
- `web/src/app/api/settings/route.ts` — FB cookie/group status
- `web/src/components/feed.tsx` — Facebook tab
- `web/src/components/post-card.tsx` — fb_post rendering
- `web/src/components/settings-form.tsx` — FB cookies + groups cards
- `extension/manifest.json` — facebook.com host permission
- `extension/popup.html` — FB cookie section
- `extension/popup.js` — FB cookie fetch + sync
