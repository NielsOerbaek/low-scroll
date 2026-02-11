# Facebook Group Digests Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Facebook group digest scraping to low-scroll so IG and FB posts appear in a unified feed.

**Architecture:** Parallel DB tables (`fb_groups`, `fb_posts`, `fb_comments`) joined with IG `posts` via SQL UNION at query time. New `FacebookClient` scrapes mbasic.facebook.com HTML. Extension, API, and UI extended for FB cookie management and group configuration.

**Tech Stack:** Python (curl_cffi, BeautifulSoup4, lxml), Next.js 16, TypeScript, SQLite, Chrome Extension Manifest v3

**Spec:** `FACEBOOK_PLAN.md` — the design doc is the authoritative source.

---

### Task 1: Add FB tables to database schema + new DB methods

**Files:**
- Modify: `scraper/src/db.py`
- Test: `scraper/tests/test_db.py`

**Step 1: Write failing tests for new FB database methods**

Add to `scraper/tests/test_db.py`:

```python
def test_initialize_creates_fb_tables(db):
    tables = db.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
    table_names = {row["name"] for row in tables}
    assert "fb_groups" in table_names
    assert "fb_posts" in table_names
    assert "fb_comments" in table_names


def test_upsert_fb_group(db):
    db.upsert_fb_group("123456", "Test Group", "https://facebook.com/groups/123456")
    group = db.get_fb_group("123456")
    assert group["name"] == "Test Group"
    assert group["url"] == "https://facebook.com/groups/123456"


def test_get_all_fb_groups(db):
    db.upsert_fb_group("111", "Group A", "https://facebook.com/groups/111")
    db.upsert_fb_group("222", "Group B", "https://facebook.com/groups/222")
    groups = db.get_all_fb_groups()
    assert len(groups) == 2


def test_delete_fb_group(db):
    db.upsert_fb_group("111", "Group A", "https://facebook.com/groups/111")
    db.delete_fb_group("111")
    assert db.get_fb_group("111") is None


def test_insert_fb_post(db):
    db.upsert_fb_group("123", "Test Group", "https://facebook.com/groups/123")
    was_new = db.insert_fb_post(
        id="fb_post_1",
        group_id="123",
        author_name="John Doe",
        content="Hello from Facebook!",
        timestamp="2026-01-15T10:00:00",
        permalink="https://facebook.com/groups/123/posts/456",
        comment_count=5,
    )
    assert was_new is True
    post = db.get_fb_post("fb_post_1")
    assert post["content"] == "Hello from Facebook!"
    assert post["comment_count"] == 5


def test_insert_fb_post_duplicate(db):
    db.upsert_fb_group("123", "Test Group", "https://facebook.com/groups/123")
    db.insert_fb_post(
        id="fb_post_1", group_id="123", author_name="John",
        content="Hello", timestamp="2026-01-15T10:00:00",
        permalink="https://facebook.com/groups/123/posts/456", comment_count=0,
    )
    was_new = db.insert_fb_post(
        id="fb_post_1", group_id="123", author_name="John",
        content="Hello", timestamp="2026-01-15T10:00:00",
        permalink="https://facebook.com/groups/123/posts/456", comment_count=0,
    )
    assert was_new is False


def test_insert_fb_comment(db):
    db.upsert_fb_group("123", "Test Group", "https://facebook.com/groups/123")
    db.insert_fb_post(
        id="fb_post_1", group_id="123", author_name="John",
        content="Hello", timestamp="2026-01-15T10:00:00",
        permalink="", comment_count=1,
    )
    db.insert_fb_comment("fb_post_1", "Jane", "Great post!", "2026-01-15T11:00:00", 0)
    comments = db.get_comments_for_post("fb_post_1")
    assert len(comments) == 1
    assert comments[0]["author_name"] == "Jane"


def test_get_unified_feed(db):
    # Insert an IG post
    db.upsert_account("iguser", None)
    db.insert_post(
        id="ig_1", username="iguser", post_type="post",
        caption="IG post", timestamp="2026-01-15T12:00:00", permalink="",
    )
    # Insert an FB post
    db.upsert_fb_group("123", "Test Group", "https://facebook.com/groups/123")
    db.insert_fb_post(
        id="fb_1", group_id="123", author_name="John",
        content="FB post", timestamp="2026-01-15T14:00:00",
        permalink="", comment_count=0,
    )
    feed = db.get_unified_feed(limit=10, offset=0)
    assert len(feed) == 2
    assert feed[0]["platform"] == "facebook"  # newer
    assert feed[1]["platform"] == "instagram"


def test_get_unified_feed_filter_platform(db):
    db.upsert_account("iguser", None)
    db.insert_post(
        id="ig_1", username="iguser", post_type="post",
        caption="IG post", timestamp="2026-01-15T12:00:00", permalink="",
    )
    db.upsert_fb_group("123", "Group", "https://facebook.com/groups/123")
    db.insert_fb_post(
        id="fb_1", group_id="123", author_name="John",
        content="FB post", timestamp="2026-01-15T14:00:00",
        permalink="", comment_count=0,
    )
    fb_only = db.get_unified_feed(limit=10, offset=0, platform="facebook")
    assert len(fb_only) == 1
    assert fb_only[0]["platform"] == "facebook"

    ig_only = db.get_unified_feed(limit=10, offset=0, platform="instagram")
    assert len(ig_only) == 1
    assert ig_only[0]["platform"] == "instagram"


def test_get_unified_feed_filter_type(db):
    db.upsert_account("iguser", None)
    db.insert_post(
        id="ig_1", username="iguser", post_type="story",
        caption="", timestamp="2026-01-15T12:00:00", permalink="",
    )
    db.upsert_fb_group("123", "Group", "https://facebook.com/groups/123")
    db.insert_fb_post(
        id="fb_1", group_id="123", author_name="John",
        content="FB post", timestamp="2026-01-15T14:00:00",
        permalink="", comment_count=0,
    )
    stories = db.get_unified_feed(limit=10, offset=0, type="story")
    assert len(stories) == 1
    assert stories[0]["id"] == "ig_1"


def test_get_new_fb_posts_since(db):
    db.upsert_fb_group("123", "Group", "https://facebook.com/groups/123")
    db.insert_fb_post(
        id="fb_1", group_id="123", author_name="John",
        content="FB post", timestamp="2026-01-15T14:00:00",
        permalink="", comment_count=0,
    )
    posts = db.get_new_fb_posts_since("2000-01-01")
    assert len(posts) == 1
    assert posts[0]["id"] == "fb_1"


def test_update_fb_group_last_checked(db):
    db.upsert_fb_group("123", "Group", "https://facebook.com/groups/123")
    db.update_fb_group_last_checked("123")
    group = db.get_fb_group("123")
    assert group["last_checked_at"] is not None
```

**Step 2: Run tests to verify they fail**

Run: `cd /home/niec/Documents/repos/ig-sub/scraper && python -m pytest tests/test_db.py -v -k "fb" --no-header`
Expected: Multiple failures — methods don't exist yet.

**Step 3: Add FB tables to `initialize()` and implement all new methods**

In `scraper/src/db.py`, add to `initialize()` after the existing `executescript`:

```python
        self.conn.executescript("""
            CREATE TABLE IF NOT EXISTS fb_groups (
                group_id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                url TEXT NOT NULL,
                last_checked_at DATETIME,
                added_at DATETIME DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS fb_posts (
                id TEXT PRIMARY KEY,
                group_id TEXT NOT NULL REFERENCES fb_groups(group_id),
                author_name TEXT,
                content TEXT,
                timestamp DATETIME,
                permalink TEXT,
                comment_count INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS fb_comments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                post_id TEXT NOT NULL REFERENCES fb_posts(id),
                author_name TEXT,
                content TEXT,
                timestamp DATETIME,
                "order" INTEGER DEFAULT 0
            );
        """)
```

Then add these methods to the `Database` class:

```python
    # --- Facebook methods ---

    def upsert_fb_group(self, group_id: str, name: str, url: str):
        self.execute(
            """INSERT INTO fb_groups (group_id, name, url)
               VALUES (?, ?, ?)
               ON CONFLICT(group_id) DO UPDATE SET name=excluded.name, url=excluded.url""",
            (group_id, name, url),
        )
        self.conn.commit()

    def get_fb_group(self, group_id: str) -> dict | None:
        row = self.execute("SELECT * FROM fb_groups WHERE group_id=?", (group_id,)).fetchone()
        return dict(row) if row else None

    def get_all_fb_groups(self) -> list[dict]:
        rows = self.execute("SELECT * FROM fb_groups ORDER BY name").fetchall()
        return [dict(r) for r in rows]

    def delete_fb_group(self, group_id: str):
        self.execute("DELETE FROM fb_comments WHERE post_id IN (SELECT id FROM fb_posts WHERE group_id=?)", (group_id,))
        self.execute("DELETE FROM fb_posts WHERE group_id=?", (group_id,))
        self.execute("DELETE FROM fb_groups WHERE group_id=?", (group_id,))
        self.conn.commit()

    def update_fb_group_last_checked(self, group_id: str):
        self.execute(
            "UPDATE fb_groups SET last_checked_at=datetime('now') WHERE group_id=?",
            (group_id,),
        )
        self.conn.commit()

    def insert_fb_post(self, id: str, group_id: str, author_name: str,
                       content: str, timestamp: str, permalink: str,
                       comment_count: int = 0) -> bool:
        try:
            self.execute(
                """INSERT INTO fb_posts (id, group_id, author_name, content, timestamp, permalink, comment_count)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (id, group_id, author_name, content, timestamp, permalink, comment_count),
            )
            self.conn.commit()
            return True
        except sqlite3.IntegrityError:
            return False

    def get_fb_post(self, post_id: str) -> dict | None:
        row = self.execute("SELECT * FROM fb_posts WHERE id=?", (post_id,)).fetchone()
        return dict(row) if row else None

    def insert_fb_comment(self, post_id: str, author_name: str, content: str,
                          timestamp: str, order: int = 0):
        self.execute(
            """INSERT INTO fb_comments (post_id, author_name, content, timestamp, "order")
               VALUES (?, ?, ?, ?, ?)""",
            (post_id, author_name, content, timestamp, order),
        )
        self.conn.commit()

    def get_comments_for_post(self, post_id: str) -> list[dict]:
        rows = self.execute(
            'SELECT * FROM fb_comments WHERE post_id=? ORDER BY "order"', (post_id,)
        ).fetchall()
        return [dict(r) for r in rows]

    def get_unified_feed(self, limit: int = 20, offset: int = 0,
                         account: str | None = None, group_id: str | None = None,
                         type: str | None = None, platform: str | None = None) -> list[dict]:
        # Build IG part
        ig_conditions = []
        ig_params = []
        if account:
            ig_conditions.append("p.username = ?")
            ig_params.append(account)
        if type == "story":
            ig_conditions.append("p.type = 'story'")
        elif type == "post":
            ig_conditions.append("p.type IN ('post', 'reel')")
        elif type == "fb_post":
            ig_conditions.append("1=0")  # exclude IG when filtering FB
        ig_where = f"WHERE {' AND '.join(ig_conditions)}" if ig_conditions else ""

        # Build FB part
        fb_conditions = []
        fb_params = []
        if group_id:
            fb_conditions.append("fp.group_id = ?")
            fb_params.append(group_id)
        if account:
            fb_conditions.append("1=0")  # exclude FB when filtering by IG account
        if type == "story" or type == "post":
            fb_conditions.append("1=0")  # exclude FB for IG-only types
        fb_where = f"WHERE {' AND '.join(fb_conditions)}" if fb_conditions else ""

        # Platform filter
        if platform == "instagram":
            fb_conditions.append("1=0")
            fb_where = f"WHERE {' AND '.join(fb_conditions)}" if fb_conditions else ""
        elif platform == "facebook":
            ig_conditions.append("1=0")
            ig_where = f"WHERE {' AND '.join(ig_conditions)}" if ig_conditions else ""

        sql = f"""
            SELECT id, username AS source_name, type, caption AS content, timestamp, permalink,
                   'instagram' AS platform, NULL AS comment_count
            FROM posts p {ig_where}
            UNION ALL
            SELECT fp.id, g.name AS source_name, 'fb_post' AS type, fp.content, fp.timestamp, fp.permalink,
                   'facebook' AS platform, fp.comment_count
            FROM fb_posts fp JOIN fb_groups g ON fp.group_id = g.group_id {fb_where}
            ORDER BY timestamp DESC
            LIMIT ? OFFSET ?
        """
        params = ig_params + fb_params + [limit, offset]
        rows = self.execute(sql, params).fetchall()
        return [dict(r) for r in rows]

    def get_new_fb_posts_since(self, since: str) -> list[dict]:
        rows = self.execute(
            "SELECT * FROM fb_posts WHERE created_at > ? ORDER BY timestamp DESC",
            (since,),
        ).fetchall()
        return [dict(r) for r in rows]
```

**Step 4: Run tests to verify they pass**

Run: `cd /home/niec/Documents/repos/ig-sub/scraper && python -m pytest tests/test_db.py -v --no-header`
Expected: All tests pass including new FB tests.

**Step 5: Commit**

```bash
git add scraper/src/db.py scraper/tests/test_db.py
git commit -m "feat: add Facebook group DB tables and methods"
```

---

### Task 2: Add FB cookie management

**Files:**
- Modify: `scraper/src/cookies.py`
- Test: `scraper/tests/test_cookies.py`

**Step 1: Write failing tests**

Add to `scraper/tests/test_cookies.py`:

```python
def test_store_and_retrieve_fb_cookies(cookie_manager):
    cookies = {"c_user": "123", "xs": "secret"}
    cookie_manager.store_fb_cookies(cookies)
    retrieved = cookie_manager.get_fb_cookies()
    assert retrieved == cookies


def test_get_fb_cookies_returns_none_when_empty(cookie_manager):
    assert cookie_manager.get_fb_cookies() is None


def test_fb_mark_stale_and_check(cookie_manager):
    cookie_manager.store_fb_cookies({"c_user": "123", "xs": "secret"})
    assert cookie_manager.is_fb_stale() is False
    cookie_manager.mark_fb_stale()
    assert cookie_manager.is_fb_stale() is True


def test_storing_new_fb_cookies_clears_stale(cookie_manager):
    cookie_manager.store_fb_cookies({"c_user": "123", "xs": "secret"})
    cookie_manager.mark_fb_stale()
    assert cookie_manager.is_fb_stale() is True
    cookie_manager.store_fb_cookies({"c_user": "456", "xs": "newsecret"})
    assert cookie_manager.is_fb_stale() is False
```

**Step 2: Run tests to verify they fail**

Run: `cd /home/niec/Documents/repos/ig-sub/scraper && python -m pytest tests/test_cookies.py -v -k "fb" --no-header`
Expected: FAIL — methods don't exist.

**Step 3: Implement FB cookie methods**

Add to `CookieManager` in `scraper/src/cookies.py`:

```python
    def store_fb_cookies(self, cookies: dict[str, str]):
        encrypted = self._encrypt(json.dumps(cookies))
        self.db.set_config("fb_cookies", encrypted)
        self.db.set_config("fb_cookies_stale", "false")

    def get_fb_cookies(self) -> dict[str, str] | None:
        encrypted = self.db.get_config("fb_cookies")
        if not encrypted:
            return None
        plaintext = self._decrypt(encrypted)
        return json.loads(plaintext)

    def mark_fb_stale(self):
        self.db.set_config("fb_cookies_stale", "true")

    def is_fb_stale(self) -> bool:
        return self.db.get_config("fb_cookies_stale") == "true"
```

**Step 4: Run tests**

Run: `cd /home/niec/Documents/repos/ig-sub/scraper && python -m pytest tests/test_cookies.py -v --no-header`
Expected: All pass.

**Step 5: Commit**

```bash
git add scraper/src/cookies.py scraper/tests/test_cookies.py
git commit -m "feat: add Facebook cookie management"
```

---

### Task 3: Create FacebookClient

**Files:**
- Create: `scraper/src/facebook.py`
- Test: `scraper/tests/test_facebook.py`
- Modify: `scraper/requirements.txt`

**Step 1: Add dependencies**

Add to `scraper/requirements.txt`:
```
beautifulsoup4>=4.12.0
lxml>=5.0.0
```

**Step 2: Write tests with mocked HTTP**

Create `scraper/tests/test_facebook.py`:

```python
import pytest
from unittest.mock import patch, MagicMock
from src.facebook import FacebookClient


MOCK_GROUP_HTML = """
<html><head><title>Test Group</title></head><body>
<div id="m_group_stories_container">
  <div class="bx">
    <div>
      <h3><a href="/profile.php?id=111">John Doe</a></h3>
      <div class="dx">
        <p>This is a test post about something interesting</p>
      </div>
      <div>
        <abbr data-utime="1737000000">Jan 15</abbr>
      </div>
      <div>
        <a href="/groups/123/posts/456/">Full Story</a>
        <a href="/groups/123/posts/456/">5 Comments</a>
      </div>
    </div>
  </div>
</div>
</body></html>
"""

MOCK_HOME_HTML = """
<html><head><title>Facebook</title></head><body>
<div id="mbasic_logout_button"><a href="/logout">Logout</a></div>
</body></html>
"""

MOCK_LOGIN_HTML = """
<html><head><title>Log into Facebook</title></head><body>
<form id="login_form"></form>
</body></html>
"""


@pytest.fixture
def fb_client():
    with patch.object(FacebookClient, 'random_delay'):
        client = FacebookClient({"c_user": "123", "xs": "secret"})
        yield client


def test_validate_session_valid(fb_client):
    mock_resp = MagicMock()
    mock_resp.text = MOCK_HOME_HTML
    mock_resp.status_code = 200
    mock_resp.url = "https://mbasic.facebook.com/"
    with patch.object(fb_client._session, 'get', return_value=mock_resp):
        assert fb_client.validate_session() is True


def test_validate_session_invalid(fb_client):
    mock_resp = MagicMock()
    mock_resp.text = MOCK_LOGIN_HTML
    mock_resp.status_code = 200
    mock_resp.url = "https://mbasic.facebook.com/login/"
    with patch.object(fb_client._session, 'get', return_value=mock_resp):
        assert fb_client.validate_session() is False


def test_get_group_name(fb_client):
    mock_resp = MagicMock()
    mock_resp.text = MOCK_GROUP_HTML
    mock_resp.status_code = 200
    with patch.object(fb_client._session, 'get', return_value=mock_resp):
        name = fb_client.get_group_name("123")
        assert name == "Test Group"
```

**Step 3: Run tests to verify they fail**

Run: `cd /home/niec/Documents/repos/ig-sub/scraper && python -m pytest tests/test_facebook.py -v --no-header`
Expected: FAIL — module doesn't exist.

**Step 4: Implement FacebookClient**

Create `scraper/src/facebook.py`:

```python
import logging
import re
import time
import random
from datetime import datetime, timezone
from curl_cffi import requests
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

MBASIC_BASE = "https://mbasic.facebook.com"


class FacebookClient:
    def __init__(self, cookies: dict[str, str]):
        self._session = requests.Session(impersonate="chrome131")
        for name, value in cookies.items():
            self._session.cookies.set(name, value, domain=".facebook.com")
        self._session.headers.update({
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "none",
        })

    def _get(self, url: str) -> str:
        self.random_delay(5.0, 10.0)
        for attempt in range(3):
            resp = self._session.get(url)
            if resp.status_code == 429:
                wait = 60 * (attempt + 1) + random.uniform(0, 30)
                logger.warning(f"Rate limited (attempt {attempt + 1}/3), waiting {wait:.0f}s...")
                time.sleep(wait)
                continue
            if resp.status_code >= 500:
                wait = 10 * (attempt + 1) + random.uniform(0, 10)
                logger.warning(f"Server error {resp.status_code} (attempt {attempt + 1}/3), retrying in {wait:.0f}s...")
                time.sleep(wait)
                continue
            resp.raise_for_status()
            return resp.text
        resp.raise_for_status()
        return resp.text

    def validate_session(self) -> bool | None:
        try:
            self.random_delay(1.0, 3.0)
            resp = self._session.get(f"{MBASIC_BASE}/")
            if resp.status_code == 429:
                logger.warning("FB session validation skipped: rate limited")
                return None
            html = resp.text
            if "login" in resp.url or "login_form" in html:
                return False
            if "mbasic_logout_button" in html or "logout" in html.lower():
                return True
            return False
        except Exception as e:
            logger.warning(f"FB session validation failed: {e}")
            return False

    def get_group_posts(self, group_id: str, limit: int = 10) -> list[dict]:
        url = f"{MBASIC_BASE}/groups/{group_id}/"
        html = self._get(url)
        soup = BeautifulSoup(html, "lxml")
        posts = []

        # mbasic groups render posts in the main content area
        # Look for article-like containers
        story_container = soup.find("div", id="m_group_stories_container")
        if not story_container:
            # Fallback: try finding post sections in the main body
            story_container = soup.find("div", role="main") or soup.body

        if not story_container:
            logger.warning(f"Could not find post container for group {group_id}")
            return []

        # Each post is typically in a div with class containing story/post markers
        # mbasic structure varies, so we look for divs that contain author + content patterns
        post_divs = story_container.find_all("div", recursive=False)

        for div in post_divs:
            if len(posts) >= limit:
                break
            try:
                post = self._parse_post(div, group_id)
                if post:
                    posts.append(post)
            except Exception as e:
                logger.debug(f"Skipping unparseable div: {e}")
                continue

        return posts

    def _parse_post(self, div, group_id: str) -> dict | None:
        # Find author — typically in an <h3> or <strong> with an <a> tag
        author_el = div.find("h3")
        if not author_el:
            author_el = div.find("strong")
        if not author_el:
            return None

        author_link = author_el.find("a")
        author_name = author_link.get_text(strip=True) if author_link else author_el.get_text(strip=True)
        if not author_name:
            return None

        # Find content text
        content = ""
        content_div = div.find("div", class_=lambda c: c and "d" in c)
        if content_div:
            content = content_div.get_text(strip=True)
        else:
            # Fallback: grab text from <p> tags
            paragraphs = div.find_all("p")
            content = "\n".join(p.get_text(strip=True) for p in paragraphs)

        # Find timestamp
        timestamp = ""
        abbr = div.find("abbr", attrs={"data-utime": True})
        if abbr:
            utime = int(abbr["data-utime"])
            timestamp = datetime.fromtimestamp(utime, tz=timezone.utc).isoformat()

        # Find permalink and extract post ID
        post_id = None
        permalink = ""
        links = div.find_all("a", href=True)
        for link in links:
            href = link["href"]
            match = re.search(r"/groups/\d+/posts/(\d+)", href)
            if match:
                story_fbid = match.group(1)
                post_id = f"fb_{story_fbid}"
                permalink = f"https://www.facebook.com/groups/{group_id}/posts/{story_fbid}/"
                break

        if not post_id:
            return None

        # Find comment count
        comment_count = 0
        for link in links:
            text = link.get_text(strip=True)
            match = re.match(r"(\d+)\s+Comment", text)
            if match:
                comment_count = int(match.group(1))
                break

        return {
            "id": post_id,
            "author_name": author_name,
            "content": content,
            "timestamp": timestamp,
            "permalink": permalink,
            "comment_count": comment_count,
        }

    def get_post_comments(self, group_id: str, story_fbid: str, limit: int = 3) -> list[dict]:
        url = f"{MBASIC_BASE}/groups/{group_id}/posts/{story_fbid}/"
        html = self._get(url)
        soup = BeautifulSoup(html, "lxml")
        comments = []

        # Comments on mbasic are typically in divs after the main post
        # Look for comment-like structures
        comment_sections = soup.find_all("div", id=re.compile(r"^[0-9]+$"))
        for i, section in enumerate(comment_sections[:limit]):
            try:
                author_el = section.find("a")
                author_name = author_el.get_text(strip=True) if author_el else "Unknown"
                # Comment text follows the author
                content_parts = []
                for el in section.find_all(["div", "span"]):
                    text = el.get_text(strip=True)
                    if text and text != author_name:
                        content_parts.append(text)
                content = " ".join(content_parts[:2]) if content_parts else ""

                timestamp = ""
                abbr = section.find("abbr", attrs={"data-utime": True})
                if abbr:
                    utime = int(abbr["data-utime"])
                    timestamp = datetime.fromtimestamp(utime, tz=timezone.utc).isoformat()

                if content:
                    comments.append({
                        "author_name": author_name,
                        "content": content,
                        "timestamp": timestamp,
                        "order": i,
                    })
            except Exception:
                continue

        return comments

    def get_group_name(self, group_id: str) -> str:
        url = f"{MBASIC_BASE}/groups/{group_id}/"
        html = self._get(url)
        soup = BeautifulSoup(html, "lxml")
        title_tag = soup.find("title")
        if title_tag:
            return title_tag.get_text(strip=True)
        return f"Group {group_id}"

    @staticmethod
    def random_delay(min_s: float = 5.0, max_s: float = 10.0):
        time.sleep(random.uniform(min_s, max_s))
```

**Step 5: Run tests**

Run: `cd /home/niec/Documents/repos/ig-sub/scraper && pip install beautifulsoup4 lxml && python -m pytest tests/test_facebook.py -v --no-header`
Expected: All pass.

**Step 6: Commit**

```bash
git add scraper/src/facebook.py scraper/tests/test_facebook.py scraper/requirements.txt
git commit -m "feat: add FacebookClient for mbasic.facebook.com scraping"
```

---

### Task 4: Integrate FB scraping into Scraper and main loop

**Files:**
- Modify: `scraper/src/scrape.py`
- Modify: `scraper/src/main.py`

**Step 1: Add `scrape_fb_group` and `scrape_all_fb_groups` to Scraper**

In `scraper/src/scrape.py`, add import and new methods:

```python
from src.facebook import FacebookClient
```

Add to `Scraper.__init__`:
```python
    def __init__(self, db: Database, ig_client: InstagramClient, downloader: MediaDownloader,
                 fb_client: FacebookClient | None = None):
        self.db = db
        self.ig = ig_client
        self.downloader = downloader
        self.fb = fb_client
```

Add new methods:
```python
    def scrape_fb_group(self, group_id: str) -> int:
        if not self.fb:
            return 0
        posts = self.fb.get_group_posts(group_id)
        new_count = 0
        for post in posts:
            was_new = self.db.insert_fb_post(
                id=post["id"],
                group_id=group_id,
                author_name=post["author_name"],
                content=post["content"],
                timestamp=post["timestamp"],
                permalink=post["permalink"],
                comment_count=post["comment_count"],
            )
            if was_new and post["comment_count"] > 0:
                # Fetch top comments for new posts
                story_fbid = post["id"].removeprefix("fb_")
                try:
                    comments = self.fb.get_post_comments(group_id, story_fbid, limit=3)
                    for comment in comments:
                        self.db.insert_fb_comment(
                            post_id=post["id"],
                            author_name=comment["author_name"],
                            content=comment["content"],
                            timestamp=comment["timestamp"],
                            order=comment["order"],
                        )
                except Exception as e:
                    logger.warning(f"Failed to fetch comments for {post['id']}: {e}")
            if was_new:
                new_count += 1
        self.db.update_fb_group_last_checked(group_id)
        return new_count

    def scrape_all_fb_groups(self) -> int:
        if not self.fb:
            return 0
        groups = self.db.get_all_fb_groups()
        total = 0
        for group in groups:
            try:
                logger.info(f"Scraping FB group: {group['name']}...")
                count = self.scrape_fb_group(group["group_id"])
                total += count
                logger.info(f"  {group['name']}: {count} new posts")
                self.fb.random_delay(15.0, 45.0)
            except Exception as e:
                logger.error(f"  Error scraping FB group {group['name']}: {e}")
        return total
```

**Step 2: Integrate FB scraping into `main.py`**

In `scraper/src/main.py`, update `run_scrape()` — after IG scraping and before the digest email, add FB scraping:

After line `logger.info(f"Scrape complete: {total_posts} posts, {total_stories} stories")`:

```python
        # --- Facebook scraping ---
        new_fb_posts = 0
        fb_cookie_mgr_cookies = cookie_mgr.get_fb_cookies()
        if fb_cookie_mgr_cookies:
            from src.facebook import FacebookClient
            fb = FacebookClient(fb_cookie_mgr_cookies)
            fb_session_ok = fb.validate_session()
            if fb_session_ok is None:
                logger.warning("FB rate limited during validation, skipping FB this run.")
            elif not fb_session_ok:
                logger.warning("FB cookies are stale!")
                cookie_mgr.mark_fb_stale()
            else:
                scraper.fb = fb
                new_fb_posts = scraper.scrape_all_fb_groups()
                logger.info(f"FB scrape complete: {new_fb_posts} new posts")
        else:
            logger.info("No FB cookies configured, skipping Facebook scraping.")
```

Update the digest section to include FB posts:

Replace the existing digest block with:
```python
        total_new = total_posts + total_stories + new_fb_posts
        if total_new > 0 and config.EMAIL_RECIPIENT:
            run_info = db.get_scrape_run(run_id)
            new_posts = db.get_new_posts_since(run_info["started_at"])
            for post in new_posts:
                post["media"] = db.get_media_for_post(post["id"])
            new_fb = db.get_new_fb_posts_since(run_info["started_at"])
            html, attachments = digest.build_html(new_posts, new_fb)
            digest.send(config.EMAIL_RECIPIENT, html, total_new, attachments=attachments)
            logger.info("Digest email sent.")
```

Also add `check_fb_cookie_test()` function (mirror of `check_cookie_test()`):

```python
def check_fb_cookie_test():
    config = Config()
    db = Database(config.DATABASE_PATH)
    db.initialize()

    status = db.get_config("fb_cookie_test")
    if status != "pending":
        db.close()
        return

    logger.info("FB cookie test requested, validating session...")
    db.set_config("fb_cookie_test", "running")
    log_lines = []

    def log(msg):
        log_lines.append(msg)
        db.set_config("fb_cookie_test_log", "\n".join(log_lines))
        logger.info(f"[fb_cookie_test] {msg}")

    log("Loading FB cookies from database...")
    cookie_mgr = CookieManager(db, config.ENCRYPTION_KEY)
    cookies = cookie_mgr.get_fb_cookies()

    if not cookies:
        log("ERROR: No FB cookies configured.")
        db.set_config("fb_cookie_test", "error:No FB cookies configured")
        db.close()
        return

    has_c_user = bool(cookies.get("c_user"))
    has_xs = bool(cookies.get("xs"))
    log(f"Found cookies: c_user={'yes' if has_c_user else 'MISSING'}, "
        f"xs={'yes' if has_xs else 'MISSING'}")

    if not has_c_user or not has_xs:
        log("ERROR: c_user and xs cookies are required.")
        db.set_config("fb_cookie_test", "error:Required cookies missing (c_user, xs)")
        db.close()
        return

    log("Creating Facebook client...")
    from src.facebook import FacebookClient
    fb = FacebookClient(cookies)

    log("Testing session against mbasic.facebook.com ...")

    try:
        session_ok = fb.validate_session()
    except Exception as e:
        log(f"ERROR: {e}")
        db.set_config("fb_cookie_test", f"error:{e}")
        db.close()
        return

    if session_ok is None:
        log("RESULT: Rate limited by Facebook. Try again later.")
        db.set_config("fb_cookie_test", "error:Rate limited, try again later")
    elif session_ok:
        log(f"RESULT: FB cookies valid — logged in as user {cookies.get('c_user', 'unknown')}")
        db.set_config("fb_cookie_test", f"valid:{cookies.get('c_user', 'unknown')}")
    else:
        log("RESULT: FB cookies are stale or invalid. Re-sync from browser.")
        db.set_config("fb_cookie_test", "error:FB cookies are stale or invalid")

    db.close()
```

Register the new job in `main()`:

```python
    scheduler.add_job(
        check_fb_cookie_test,
        IntervalTrigger(seconds=10),
        id="fb_cookie_test_check",
        name="FB Cookie Test Check",
    )
```

**Step 3: Run existing tests to make sure nothing broke**

Run: `cd /home/niec/Documents/repos/ig-sub/scraper && python -m pytest tests/ -v --no-header`
Expected: All existing tests still pass (Scraper tests may need `fb_client=None` default param — which we added).

**Step 4: Commit**

```bash
git add scraper/src/scrape.py scraper/src/main.py
git commit -m "feat: integrate Facebook scraping into scraper and main loop"
```

---

### Task 5: Update digest email for FB posts

**Files:**
- Modify: `scraper/src/digest.py`
- Modify: `scraper/templates/digest.html`

**Step 1: Update `build_html` to accept FB posts**

In `scraper/src/digest.py`, modify `build_html` signature and body:

```python
    def build_html(self, posts: list[dict], fb_posts: list[dict] | None = None) -> tuple[str, list[dict]]:
```

Before the template render, group FB posts by group:

```python
        fb_grouped = {}
        fb_count = 0
        if fb_posts:
            for p in fb_posts:
                group_id = p.get("group_id", "unknown")
                fb_grouped.setdefault(group_id, []).append(p)
                fb_count += 1
```

Pass to template:
```python
        html = template.render(
            grouped_posts={u: grouped[u] for u in account_list},
            post_count=post_count,
            story_count=story_count,
            account_count=len(grouped),
            account_list=account_list,
            base_url=self.base_url,
            fb_grouped=fb_grouped,
            fb_count=fb_count,
        )
```

Update `send()` subject line:
```python
    def send(self, to_email: str, html: str, post_count: int, attachments: list[dict] | None = None):
        payload = {
            "from": self.from_email,
            "to": [to_email],
            "subject": f"low-scroll digest: {post_count} new item{'s' if post_count != 1 else ''}",
            "html": html,
        }
```

**Step 2: Add FB section to digest.html**

After the IG posts `{% endfor %}` block and before the footer in `scraper/templates/digest.html`, add:

```html
        <!-- Facebook posts -->
        {% if fb_grouped %}
        <tr><td style="padding:4px 24px 0;">
          <table width="100%" cellpadding="0" cellspacing="0" style="height:3px;margin-bottom:12px;">
            <tr><td style="background:#1877f2;height:3px;font-size:0;">&nbsp;</td></tr>
          </table>
        </td></tr>

        {% for group_id, fb_posts in fb_grouped.items() %}
        <tr><td style="padding:4px 24px 12px;">
          <p style="margin:0 0 10px;font-family:'Courier New',Courier,monospace;font-size:14px;font-weight:bold;color:#1877f2;">
            {{ fb_posts[0].get('group_name', 'Facebook Group') if fb_posts else 'Facebook Group' }}
          </p>

          {% for post in fb_posts %}
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #dbdbdb;border-radius:8px;margin-bottom:12px;">
            <tr><td style="padding:12px 14px;">
              <span style="display:inline-block;font-family:'Courier New',Courier,monospace;font-size:11px;padding:2px 8px;border-radius:4px;background:#e7f3ff;color:#1877f2;font-weight:bold;">facebook</span>
              <span style="font-family:'Courier New',Courier,monospace;font-size:12px;color:#8e8e8e;margin-left:6px;">{{ post.author_name }}</span>

              {% if post.content %}
              <p style="margin:8px 0 6px;font-family:'Courier New',Courier,monospace;font-size:13px;color:#262626;line-height:1.4;">{{ post.content[:300] }}{% if post.content|length > 300 %}…{% endif %}</p>
              {% endif %}

              <p style="margin:6px 0 0;font-family:'Courier New',Courier,monospace;font-size:11px;color:#8e8e8e;">
                {{ post.timestamp }}
                {% if post.comment_count %}
                &nbsp;&middot;&nbsp; {{ post.comment_count }} comment{{ 's' if post.comment_count != 1 else '' }}
                {% endif %}
                {% if post.permalink %}
                &nbsp;&middot;&nbsp;
                <a href="{{ post.permalink }}" style="color:#1877f2;text-decoration:none;">View on Facebook &rarr;</a>
                {% endif %}
              </p>
            </td></tr>
          </table>
          {% endfor %}
        </td></tr>
        {% endfor %}
        {% endif %}
```

**Step 3: Run existing digest tests**

Run: `cd /home/niec/Documents/repos/ig-sub/scraper && python -m pytest tests/test_digest.py -v --no-header`
Expected: Pass (the new `fb_posts` param is optional with default `None`).

**Step 4: Commit**

```bash
git add scraper/src/digest.py scraper/templates/digest.html
git commit -m "feat: add Facebook posts to digest email"
```

---

### Task 6: Chrome extension — add Facebook cookie sync

**Files:**
- Modify: `extension/manifest.json`
- Modify: `extension/popup.html`
- Modify: `extension/popup.js`

**Step 1: Update manifest.json**

Add Facebook host permission and update description:

```json
{
  "manifest_version": 3,
  "name": "low-scroll Cookie Sync",
  "version": "1.3",
  "description": "Sync Instagram and Facebook cookies to your low-scroll instance",
  "permissions": ["cookies", "storage"],
  "host_permissions": ["https://*.instagram.com/*", "https://*.facebook.com/*"],
  "action": {
    "default_popup": "popup.html",
    "default_icon": "icon-128.png"
  },
  "icons": {
    "128": "icon-128.png"
  }
}
```

**Step 2: Update popup.html**

After the existing `<div id="status" class="status"></div>`, add a Facebook section:

```html
  <hr />

  <h1>facebook cookies</h1>
  <div id="fb-cookies-list"></div>

  <button id="fb-sync" disabled>Sync FB Cookies</button>
  <div id="fb-status" class="status"></div>
```

**Step 3: Update popup.js**

Add FB cookie loading and syncing. After the existing `loadCookies()` call at the bottom, add:

```javascript
let fbFoundCookies = {};

async function loadFbCookies() {
  const list = document.getElementById("fb-cookies-list");
  list.innerHTML = "";

  const allCookies = await chrome.cookies.getAll({ domain: ".facebook.com" });
  fbFoundCookies = {};

  for (const cookie of allCookies) {
    fbFoundCookies[cookie.name] = cookie.value;
  }

  const count = Object.keys(fbFoundCookies).length;
  const hasCUser = "c_user" in fbFoundCookies;

  const keyCookies = ["c_user", "xs", "fr", "datr", "sb"];
  for (const name of keyCookies) {
    const row = document.createElement("div");
    row.className = "cookie-row";
    if (name in fbFoundCookies) {
      row.innerHTML = `<span class="name">${name}</span><span class="val found">${fbFoundCookies[name].slice(0, 20)}...</span>`;
    } else {
      row.innerHTML = `<span class="name">${name}</span><span class="val missing">not found</span>`;
    }
    list.appendChild(row);
  }

  const countRow = document.createElement("div");
  countRow.className = "cookie-row";
  countRow.innerHTML = `<span class="name">total</span><span class="val ${hasCUser ? 'found' : 'missing'}">${count} cookies</span>`;
  list.appendChild(countRow);

  document.getElementById("fb-sync").disabled = !hasCUser;

  if (!hasCUser) {
    setFbStatus("Log into facebook.com first", "err");
  }
}

function setFbStatus(msg, type) {
  const el = document.getElementById("fb-status");
  el.textContent = msg;
  el.className = "status " + (type || "");
}

async function syncFbCookies() {
  const url = document.getElementById("url").value.replace(/\/$/, "");
  const password = document.getElementById("password").value;

  if (!url) return setFbStatus("Enter instance URL", "err");
  if (!password) return setFbStatus("Enter admin password", "err");

  const btn = document.getElementById("fb-sync");
  btn.disabled = true;
  btn.textContent = "Syncing...";
  setFbStatus("");

  try {
    const res = await fetch(`${url}/api/extension/fb-cookies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password, cookies: fbFoundCookies }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `HTTP ${res.status}`);
    }

    const count = Object.keys(fbFoundCookies).length;
    setFbStatus(`${count} FB cookies synced!`, "ok");
  } catch (e) {
    setFbStatus(e.message, "err");
  }

  btn.disabled = false;
  btn.textContent = "Sync FB Cookies";
}

document.getElementById("fb-sync").addEventListener("click", syncFbCookies);
loadFbCookies();
```

**Step 4: Commit**

```bash
git add extension/manifest.json extension/popup.html extension/popup.js
git commit -m "feat: add Facebook cookie sync to Chrome extension"
```

---

### Task 7: Web API routes — FB cookies, FB cookie test, FB groups

**Files:**
- Create: `web/src/app/api/extension/fb-cookies/route.ts`
- Create: `web/src/app/api/cookies/fb-test/route.ts`
- Create: `web/src/app/api/fb-groups/route.ts`

**Step 1: Create FB cookie extension route**

Create `web/src/app/api/extension/fb-cookies/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { validatePassword } from "@/lib/auth";
import { setConfig } from "@/lib/db";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { password, cookies } = body;

  if (!password || !validatePassword(password)) {
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }

  if (!cookies?.c_user || !cookies?.xs) {
    return NextResponse.json({ error: "Missing required cookies (c_user, xs)" }, { status: 400 });
  }

  const encryptionKey = process.env.ENCRYPTION_KEY || "";
  if (!encryptionKey) {
    return NextResponse.json({ error: "Encryption key not configured" }, { status: 500 });
  }

  const { Fernet } = await import("@/lib/fernet");
  const fernet = new Fernet(encryptionKey);
  const encrypted = fernet.encrypt(JSON.stringify(cookies));
  setConfig("fb_cookies", encrypted);
  setConfig("fb_cookies_stale", "false");

  const res = NextResponse.json({ ok: true });
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "Content-Type");
  return res;
}

export async function OPTIONS() {
  const res = new NextResponse(null, { status: 204 });
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "Content-Type");
  return res;
}
```

**Step 2: Create FB cookie test route**

Create `web/src/app/api/cookies/fb-test/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { getConfig, setConfig } from "@/lib/db";

export async function POST() {
  setConfig("fb_cookie_test", "pending");
  setConfig("fb_cookie_test_log", "Queued, waiting for scraper to pick up...");
  return NextResponse.json({ ok: true });
}

export async function GET() {
  const status = getConfig("fb_cookie_test");
  const log = getConfig("fb_cookie_test_log") || "";

  if (!status || status === "pending" || status === "running") {
    return NextResponse.json({ status: status || "idle", log });
  }

  const [result, ...rest] = status.split(":");
  const detail = rest.join(":");

  setConfig("fb_cookie_test", "idle");

  if (result === "valid") {
    return NextResponse.json({ status: "valid", userId: detail, log });
  }
  return NextResponse.json({ status: "error", error: detail, log });
}
```

**Step 3: Create FB groups CRUD route**

Create `web/src/app/api/fb-groups/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getFbGroups, addFbGroup, deleteFbGroup } from "@/lib/db";

export async function GET() {
  try {
    const groups = getFbGroups();
    return NextResponse.json({ groups });
  } catch {
    return NextResponse.json({ groups: [] });
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { groupId, name, url } = body;

  if (!groupId || !url) {
    return NextResponse.json({ error: "groupId and url are required" }, { status: 400 });
  }

  try {
    const groups = getFbGroups();
    if (groups.length >= 3) {
      return NextResponse.json({ error: "Maximum 3 groups allowed" }, { status: 400 });
    }
    addFbGroup(groupId, name || `Group ${groupId}`, url);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const groupId = searchParams.get("groupId");

  if (!groupId) {
    return NextResponse.json({ error: "groupId is required" }, { status: 400 });
  }

  try {
    deleteFbGroup(groupId);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
```

**Step 4: Commit**

```bash
git add web/src/app/api/extension/fb-cookies/route.ts web/src/app/api/cookies/fb-test/route.ts web/src/app/api/fb-groups/route.ts
git commit -m "feat: add FB cookie, FB cookie test, and FB groups API routes"
```

---

### Task 8: Web DB layer — add FB queries and unified feed

**Files:**
- Modify: `web/src/lib/db.ts`

**Step 1: Add FB interfaces and query functions**

Add to `web/src/lib/db.ts`:

```typescript
export interface FbGroup {
  group_id: string;
  name: string;
  url: string;
  last_checked_at: string | null;
  added_at: string;
}

export interface FbPost {
  id: string;
  group_id: string;
  author_name: string;
  content: string | null;
  timestamp: string;
  permalink: string;
  comment_count: number;
  created_at: string;
}

export interface FbComment {
  id: number;
  post_id: string;
  author_name: string;
  content: string;
  timestamp: string;
  order: number;
}

export interface UnifiedFeedItem {
  id: string;
  source_name: string;
  type: string;
  content: string | null;
  timestamp: string;
  permalink: string;
  platform: "instagram" | "facebook";
  comment_count: number | null;
}

export function getFbGroups(): FbGroup[] {
  return getDb().prepare("SELECT * FROM fb_groups ORDER BY name").all() as FbGroup[];
}

export function addFbGroup(groupId: string, name: string, url: string): void {
  const db = getWritableDb();
  db.prepare(
    "INSERT INTO fb_groups (group_id, name, url) VALUES (?, ?, ?) ON CONFLICT(group_id) DO UPDATE SET name=excluded.name, url=excluded.url"
  ).run(groupId, name, url);
  db.close();
}

export function deleteFbGroup(groupId: string): void {
  const db = getWritableDb();
  db.prepare("DELETE FROM fb_comments WHERE post_id IN (SELECT id FROM fb_posts WHERE group_id=?)").run(groupId);
  db.prepare("DELETE FROM fb_posts WHERE group_id=?").run(groupId);
  db.prepare("DELETE FROM fb_groups WHERE group_id=?").run(groupId);
  db.close();
}

export function getFbPost(postId: string): FbPost | undefined {
  return getDb().prepare("SELECT * FROM fb_posts WHERE id = ?").get(postId) as FbPost | undefined;
}

export function getCommentsForPost(postId: string): FbComment[] {
  return getDb()
    .prepare('SELECT * FROM fb_comments WHERE post_id = ? ORDER BY "order"')
    .all(postId) as FbComment[];
}
```

Now modify the existing `getFeed` to become `getUnifiedFeed`:

```typescript
export function getUnifiedFeed(
  limit = 20,
  offset = 0,
  account?: string,
  type?: string,
  platform?: string,
  groupId?: string
): UnifiedFeedItem[] {
  const db = getDb();

  // Build IG conditions
  const igConditions: string[] = [];
  const igParams: any[] = [];
  if (account) {
    igConditions.push("p.username = ?");
    igParams.push(account);
  }
  if (type === "story") {
    igConditions.push("p.type = 'story'");
  } else if (type === "post") {
    igConditions.push("p.type IN ('post', 'reel')");
  } else if (type === "fb_post") {
    igConditions.push("1=0");
  }
  if (platform === "facebook") {
    igConditions.push("1=0");
  }

  // Build FB conditions
  const fbConditions: string[] = [];
  const fbParams: any[] = [];
  if (groupId) {
    fbConditions.push("fp.group_id = ?");
    fbParams.push(groupId);
  }
  if (account) {
    fbConditions.push("1=0");
  }
  if (type === "story" || type === "post") {
    fbConditions.push("1=0");
  }
  if (platform === "instagram") {
    fbConditions.push("1=0");
  }

  const igWhere = igConditions.length > 0 ? `WHERE ${igConditions.join(" AND ")}` : "";
  const fbWhere = fbConditions.length > 0 ? `WHERE ${fbConditions.join(" AND ")}` : "";

  const sql = `
    SELECT p.id, p.username AS source_name, p.type, p.caption AS content, p.timestamp, p.permalink,
           'instagram' AS platform, NULL AS comment_count
    FROM posts p ${igWhere}
    UNION ALL
    SELECT fp.id, g.name AS source_name, 'fb_post' AS type, fp.content, fp.timestamp, fp.permalink,
           'facebook' AS platform, fp.comment_count
    FROM fb_posts fp JOIN fb_groups g ON fp.group_id = g.group_id ${fbWhere}
    ORDER BY timestamp DESC
    LIMIT ? OFFSET ?
  `;
  const params = [...igParams, ...fbParams, limit, offset];
  return db.prepare(sql).all(...params) as UnifiedFeedItem[];
}
```

Keep the old `getFeed` function as-is (it's still used internally). Add `getUnifiedFeed` as the new function.

**Step 2: Commit**

```bash
git add web/src/lib/db.ts
git commit -m "feat: add FB database queries and unified feed to web layer"
```

---

### Task 9: Update feed API route to use unified feed

**Files:**
- Modify: `web/src/app/api/feed/route.ts`

**Step 1: Switch to unified feed query**

Replace `web/src/app/api/feed/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getUnifiedFeed, getMediaForPost, getCommentsForPost } from "@/lib/db";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20") || 20));
  const offset = Math.max(0, parseInt(searchParams.get("offset") || "0") || 0);
  const account = searchParams.get("account") || undefined;
  const type = searchParams.get("type") || undefined;
  const platform = searchParams.get("platform") || undefined;
  const groupId = searchParams.get("groupId") || undefined;

  try {
    const posts = getUnifiedFeed(limit, offset, account, type, platform, groupId);
    const enriched = posts.map((post) => {
      if (post.platform === "instagram") {
        return { ...post, media: getMediaForPost(post.id) };
      }
      // FB posts: attach comments
      return { ...post, comments: getCommentsForPost(post.id) };
    });

    return NextResponse.json({ posts: enriched, hasMore: posts.length === limit });
  } catch {
    return NextResponse.json({ posts: [], hasMore: false });
  }
}
```

**Step 2: Commit**

```bash
git add web/src/app/api/feed/route.ts
git commit -m "feat: switch feed API to unified feed with FB support"
```

---

### Task 10: Update settings API to include FB status

**Files:**
- Modify: `web/src/app/api/settings/route.ts`

**Step 1: Add FB fields to settings GET**

In the GET handler, add after the existing fields:

```typescript
    const hasFbCookies = getConfig("fb_cookies") !== null;
    const fbCookiesStale = getConfig("fb_cookies_stale") === "true";
```

Return them:
```typescript
    return NextResponse.json({
      hasCookies,
      cookiesStale: cookieStatus === "true",
      cronSchedule,
      emailRecipient,
      hasFbCookies,
      fbCookiesStale,
    });
```

Update error fallback too:
```typescript
    return NextResponse.json({
      hasCookies: false,
      cookiesStale: false,
      cronSchedule: "0 8 * * *",
      emailRecipient: process.env.EMAIL_RECIPIENT || "",
      hasFbCookies: false,
      fbCookiesStale: false,
    });
```

**Step 2: Commit**

```bash
git add web/src/app/api/settings/route.ts
git commit -m "feat: include FB cookie status in settings API"
```

---

### Task 11: Update Feed component — add Facebook tab

**Files:**
- Modify: `web/src/components/feed.tsx`

**Step 1: Add Facebook tab**

Update the TABS constant:

```typescript
const TABS = [
  { key: "all", label: "All" },
  { key: "post", label: "Posts" },
  { key: "story", label: "Stories" },
  { key: "fb_post", label: "Facebook" },
] as const;
```

Update the fetch URL in `loadPosts` to pass type `fb_post`:

The existing logic already handles this — `if (tab !== "all") params.set("type", tab)` will set `type=fb_post` which the unified feed query handles.

**Step 2: Commit**

```bash
git add web/src/components/feed.tsx
git commit -m "feat: add Facebook tab to feed"
```

---

### Task 12: Update PostCard — render FB posts

**Files:**
- Modify: `web/src/components/post-card.tsx`

**Step 1: Extend PostCardProps and add FB rendering**

Update the interface:

```typescript
interface FbComment {
  id: number;
  author_name: string;
  content: string;
}

interface PostCardProps {
  post: {
    id: string;
    // IG fields
    username?: string;
    type: string;
    caption?: string | null;
    timestamp: string;
    media?: PostMedia[];
    // Unified feed fields
    source_name?: string;
    content?: string | null;
    platform?: "instagram" | "facebook";
    permalink?: string;
    comment_count?: number | null;
    comments?: FbComment[];
  };
}
```

Update the `PostCard` component:

```typescript
export function PostCard({ post }: PostCardProps) {
  const isFb = post.platform === "facebook";

  if (isFb) {
    return (
      <Card className="overflow-hidden !py-0 !gap-0">
        <div className="flex items-center gap-2 px-3 py-0.5">
          <span className="text-sm font-semibold">{post.source_name}</span>
          <Badge variant="secondary" className="text-xs bg-blue-100 text-blue-700">fb</Badge>
          {post.source_name !== (post as any).author_name && (
            <span className="text-xs text-muted-foreground">{(post as any).author_name}</span>
          )}
          <span className="text-xs text-muted-foreground ml-auto">
            {new Date(post.timestamp).toLocaleDateString()}
          </span>
        </div>
        {post.content && <Caption text={post.content} />}
        {post.comments && post.comments.length > 0 && (
          <CardContent className="px-3 py-1 border-t">
            {post.comments.map((c, i) => (
              <p key={i} className="text-xs text-muted-foreground py-0.5">
                <span className="font-medium text-foreground">{c.author_name}</span>{" "}
                {c.content}
              </p>
            ))}
          </CardContent>
        )}
        <CardContent className="px-3 py-1 border-t">
          <div className="flex items-center gap-2">
            {post.comment_count != null && post.comment_count > 0 && (
              <span className="text-xs text-muted-foreground">
                {post.comment_count} comment{post.comment_count !== 1 ? "s" : ""}
              </span>
            )}
            {post.permalink && (
              <a
                href={post.permalink}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-600 hover:underline ml-auto"
              >
                View on Facebook &rarr;
              </a>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  // Original IG rendering
  const username = post.username || post.source_name || "";
  return (
    <Card className="overflow-hidden !py-0 !gap-0">
      <div className="flex items-center gap-2 px-3 py-0.5">
        <Link href={`/account/${username}`} className="text-sm font-semibold hover:underline">
          @{username}
        </Link>
        <Badge variant="secondary" className="text-xs">{post.type}</Badge>
        <span className="text-xs text-muted-foreground ml-auto">
          {new Date(post.timestamp).toLocaleDateString()}
        </span>
      </div>
      {post.media && <MediaCarousel media={post.media} />}
      {(post.caption || post.content) && <Caption text={(post.caption || post.content)!} />}
    </Card>
  );
}
```

**Step 2: Commit**

```bash
git add web/src/components/post-card.tsx
git commit -m "feat: render Facebook posts in PostCard"
```

---

### Task 13: Update Settings UI — FB cookies + FB groups

**Files:**
- Modify: `web/src/components/settings-form.tsx`

**Step 1: Add FB state and UI sections**

Add new state variables:
```typescript
  const [fbTesting, setFbTesting] = useState(false);
  const [fbTestLog, setFbTestLog] = useState("");
  const [fbMessage, setFbMessage] = useState("");
  const [fbGroups, setFbGroups] = useState<any[]>([]);
  const [newGroupUrl, setNewGroupUrl] = useState("");
```

Load FB groups in useEffect:
```typescript
  useEffect(() => {
    fetch("/api/settings").then((r) => r.json()).then((data) => {
      setSettings(data);
      setCronSchedule(data.cronSchedule);
      setEmailRecipient(data.emailRecipient);
    });
    fetch("/api/fb-groups").then((r) => r.json()).then((data) => {
      setFbGroups(data.groups || []);
    });
  }, []);
```

Add a helper to parse group ID from URL:
```typescript
  function parseGroupId(url: string): string | null {
    const match = url.match(/facebook\.com\/groups\/([^/?\s]+)/);
    return match ? match[1] : null;
  }
```

Add FB cookies card after the IG cookies card:
```tsx
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Facebook Cookies
            {settings.hasFbCookies && !settings.fbCookiesStale && (
              <Badge className="bg-blue-100 text-blue-800">Active</Badge>
            )}
            {settings.fbCookiesStale && (
              <Badge variant="destructive">Stale - update required</Badge>
            )}
            {!settings.hasFbCookies && (
              <Badge variant="secondary">Not configured</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Sync Facebook cookies using the Chrome extension. Required cookies: c_user, xs.
          </p>
          {settings.hasFbCookies && (
            <Button
              variant="outline"
              disabled={fbTesting}
              onClick={async () => {
                setFbTesting(true);
                setFbMessage("");
                setFbTestLog("");
                await fetch("/api/cookies/fb-test", { method: "POST" });
                const poll = setInterval(async () => {
                  try {
                    const res = await fetch("/api/cookies/fb-test");
                    const data = await res.json();
                    if (data.log) setFbTestLog(data.log);
                    if (data.status === "valid") {
                      clearInterval(poll);
                      setFbMessage(`FB cookies valid — user ID ${data.userId}`);
                      setFbTesting(false);
                    } else if (data.status === "error") {
                      clearInterval(poll);
                      setFbMessage(`FB cookie test failed: ${data.error}`);
                      setFbTesting(false);
                    }
                  } catch {
                    clearInterval(poll);
                    setFbMessage("FB cookie test failed: network error");
                    setFbTesting(false);
                  }
                }, 3000);
                setTimeout(() => {
                  clearInterval(poll);
                  if (fbTesting) {
                    setFbMessage("FB cookie test timed out");
                    setFbTesting(false);
                  }
                }, 300000);
              }}
            >
              {fbTesting ? "Testing..." : "Test FB Cookies"}
            </Button>
          )}
          {fbTestLog && (
            <pre className="max-h-48 overflow-auto border bg-muted p-2 text-xs text-muted-foreground whitespace-pre-wrap">
              {fbTestLog}
            </pre>
          )}
          {fbMessage && <p className="text-sm text-blue-600">{fbMessage}</p>}
        </CardContent>
      </Card>
```

Add FB groups card:
```tsx
      <Card>
        <CardHeader>
          <CardTitle>Facebook Groups</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {fbGroups.map((group: any) => (
            <div key={group.group_id} className="flex items-center gap-2">
              <span className="text-sm flex-1">{group.name}</span>
              <span className="text-xs text-muted-foreground">{group.group_id}</span>
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  await fetch(`/api/fb-groups?groupId=${group.group_id}`, { method: "DELETE" });
                  setFbGroups((prev) => prev.filter((g: any) => g.group_id !== group.group_id));
                }}
              >
                Remove
              </Button>
            </div>
          ))}
          {fbGroups.length < 3 && (
            <div className="flex gap-2">
              <Input
                value={newGroupUrl}
                onChange={(e) => setNewGroupUrl(e.target.value)}
                placeholder="https://facebook.com/groups/..."
              />
              <Button
                onClick={async () => {
                  const groupId = parseGroupId(newGroupUrl);
                  if (!groupId) {
                    setMessage("Invalid Facebook group URL");
                    return;
                  }
                  await fetch("/api/fb-groups", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ groupId, name: `Group ${groupId}`, url: newGroupUrl }),
                  });
                  const data = await fetch("/api/fb-groups").then((r) => r.json());
                  setFbGroups(data.groups || []);
                  setNewGroupUrl("");
                }}
                disabled={!newGroupUrl}
              >
                Add
              </Button>
            </div>
          )}
          <p className="text-xs text-muted-foreground">Maximum 3 groups. Paste the full group URL.</p>
        </CardContent>
      </Card>
```

**Step 2: Commit**

```bash
git add web/src/components/settings-form.tsx
git commit -m "feat: add Facebook cookies and groups management to settings"
```

---

### Task 14: Create FB post detail page

**Files:**
- Create: `web/src/app/fb-post/[id]/page.tsx`

**Step 1: Create the page**

Create `web/src/app/fb-post/[id]/page.tsx`:

```tsx
import { getFbPost, getCommentsForPost } from "@/lib/db";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { notFound } from "next/navigation";

export default async function FbPostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const post = getFbPost(id);
  if (!post) notFound();

  const comments = getCommentsForPost(id);

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-4">
        <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">&larr; Back to feed</Link>
      </div>

      <div className="flex items-center gap-2 mb-4">
        <span className="font-semibold">{post.author_name}</span>
        <Badge variant="secondary" className="bg-blue-100 text-blue-700">facebook</Badge>
        <span className="text-sm text-muted-foreground">
          {new Date(post.timestamp).toLocaleString()}
        </span>
      </div>

      {post.content && (
        <p className="text-sm whitespace-pre-wrap mb-4">{post.content}</p>
      )}

      {comments.length > 0 && (
        <div className="border-t pt-4 space-y-2">
          <h3 className="text-sm font-semibold">Comments</h3>
          {comments.map((c) => (
            <div key={c.id} className="text-sm">
              <span className="font-medium">{c.author_name}</span>{" "}
              <span className="text-muted-foreground">{c.content}</span>
            </div>
          ))}
        </div>
      )}

      {post.permalink && (
        <a
          href={post.permalink}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block mt-4 text-sm text-blue-600 hover:underline"
        >
          View on Facebook &rarr;
        </a>
      )}
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add web/src/app/fb-post/[id]/page.tsx
git commit -m "feat: add Facebook post detail page"
```

---

### Task 15: Run all tests and verify

**Step 1: Run all Python tests**

Run: `cd /home/niec/Documents/repos/ig-sub/scraper && python -m pytest tests/ -v --no-header`
Expected: All pass.

**Step 2: Verify Next.js builds**

Run: `cd /home/niec/Documents/repos/ig-sub/web && npm run build`
Expected: Build succeeds with no type errors.

**Step 3: Final commit if any fixups needed**

```bash
git add -A
git commit -m "fix: address any build/test issues from FB integration"
```

---

## Summary of all files

### Create (5 files)
- `scraper/src/facebook.py` — FacebookClient
- `scraper/tests/test_facebook.py` — FacebookClient tests
- `web/src/app/api/extension/fb-cookies/route.ts` — Extension FB cookie sync
- `web/src/app/api/cookies/fb-test/route.ts` — FB cookie test trigger/poll
- `web/src/app/api/fb-groups/route.ts` — FB groups CRUD
- `web/src/app/fb-post/[id]/page.tsx` — FB post detail page

### Modify (12 files)
- `scraper/src/db.py` — FB tables + methods
- `scraper/tests/test_db.py` — FB tests
- `scraper/src/cookies.py` — FB cookie methods
- `scraper/tests/test_cookies.py` — FB cookie tests
- `scraper/src/scrape.py` — FB scraping methods
- `scraper/src/main.py` — FB in cron + FB cookie test
- `scraper/src/digest.py` — Accept FB posts
- `scraper/templates/digest.html` — FB section
- `scraper/requirements.txt` — beautifulsoup4, lxml
- `web/src/lib/db.ts` — FB interfaces + unified feed
- `web/src/app/api/feed/route.ts` — Unified feed + comments
- `web/src/app/api/settings/route.ts` — FB cookie status
- `web/src/components/feed.tsx` — Facebook tab
- `web/src/components/post-card.tsx` — FB post rendering
- `web/src/components/settings-form.tsx` — FB cookies + groups UI
- `extension/manifest.json` — Facebook host permission
- `extension/popup.html` — FB section
- `extension/popup.js` — FB cookie fetch + sync
