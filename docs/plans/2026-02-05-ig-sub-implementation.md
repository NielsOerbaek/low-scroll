# ig-sub Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a self-hosted Instagram digest service that scrapes followed accounts, archives media locally, sends email digests, and serves a private web feed.

**Architecture:** Python scraper + Next.js web feed + Caddy reverse proxy, all in Docker Compose. SQLite shared database, local media volume. Password-protected UI at ig.raakode.dk.

**Tech Stack:** Python 3.12 (instagrapi, resend, APScheduler, Jinja2, cryptography), Next.js 15 (App Router, shadcn/ui, better-sqlite3, Tailwind CSS), Caddy, Docker Compose, SQLite.

---

### Task 1: Project Scaffold & Docker Compose

**Files:**
- Create: `docker-compose.yml`
- Create: `.env.example`
- Create: `Caddyfile`
- Create: `.gitignore`
- Create: `scraper/Dockerfile`
- Create: `scraper/requirements.txt`
- Create: `web/Dockerfile`

**Step 1: Create `.gitignore`**

```gitignore
# Data
data/

# Python
__pycache__/
*.pyc
.venv/
scraper/.venv/

# Node
node_modules/
.next/

# Env
.env
```

**Step 2: Create `.env.example`**

```env
ENCRYPTION_KEY=generate-a-32-byte-hex-key
RESEND_API_KEY=re_xxxxx
EMAIL_RECIPIENT=you@example.com
ADMIN_PASSWORD=changeme
BASE_URL=https://ig.raakode.dk
CRON_SCHEDULE=0 8 * * *
```

**Step 3: Create `scraper/requirements.txt`**

```
instagrapi==2.1.2
resend>=2.0.0
APScheduler>=3.10.0
croniter>=2.0.0
Jinja2>=3.1.0
cryptography>=42.0.0
Pillow>=10.0.0
```

**Step 4: Create `scraper/Dockerfile`**

```dockerfile
FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY src/ ./src/
COPY templates/ ./templates/

CMD ["python", "-m", "src.main"]
```

**Step 5: Create `web/Dockerfile`**

```dockerfile
FROM node:20-alpine AS builder

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 3000
CMD ["node", "server.js"]
```

**Step 6: Create `Caddyfile`**

```
ig.raakode.dk {
    reverse_proxy web:3000
}
```

**Step 7: Create `docker-compose.yml`**

```yaml
services:
  caddy:
    image: caddy:2-alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - ./data/caddy:/data
    depends_on:
      - web
    restart: unless-stopped

  web:
    build: ./web
    expose:
      - "3000"
    environment:
      - DATABASE_PATH=/data/db/ig.db
      - MEDIA_PATH=/data/media
      - ADMIN_PASSWORD=${ADMIN_PASSWORD}
      - BASE_URL=${BASE_URL}
      - ENCRYPTION_KEY=${ENCRYPTION_KEY}
    volumes:
      - ./data/db:/data/db
      - ./data/media:/data/media
    restart: unless-stopped

  scraper:
    build: ./scraper
    environment:
      - DATABASE_PATH=/data/db/ig.db
      - MEDIA_PATH=/data/media
      - ENCRYPTION_KEY=${ENCRYPTION_KEY}
      - RESEND_API_KEY=${RESEND_API_KEY}
      - EMAIL_RECIPIENT=${EMAIL_RECIPIENT}
      - CRON_SCHEDULE=${CRON_SCHEDULE}
      - BASE_URL=${BASE_URL}
    volumes:
      - ./data/db:/data/db
      - ./data/media:/data/media
    restart: unless-stopped
```

**Step 8: Commit**

```bash
git add -A
git commit -m "feat: project scaffold with Docker Compose, Caddy, and Dockerfiles"
```

---

### Task 2: SQLite Database Layer (Python)

**Files:**
- Create: `scraper/src/__init__.py`
- Create: `scraper/src/db.py`
- Create: `scraper/tests/__init__.py`
- Create: `scraper/tests/test_db.py`

**Step 1: Write the failing test**

```python
# scraper/tests/test_db.py
import os
import tempfile
import pytest
from src.db import Database


@pytest.fixture
def db():
    with tempfile.TemporaryDirectory() as tmpdir:
        db_path = os.path.join(tmpdir, "test.db")
        database = Database(db_path)
        database.initialize()
        yield database


def test_initialize_creates_tables(db):
    tables = db.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
    table_names = {row["name"] for row in tables}
    assert "accounts" in table_names
    assert "posts" in table_names
    assert "media" in table_names
    assert "config" in table_names
    assert "scrape_runs" in table_names


def test_upsert_account(db):
    db.upsert_account("testuser", "/pics/test.jpg")
    account = db.get_account("testuser")
    assert account["username"] == "testuser"
    assert account["profile_pic_path"] == "/pics/test.jpg"


def test_insert_post(db):
    db.upsert_account("testuser", None)
    db.insert_post(
        id="abc123",
        username="testuser",
        post_type="post",
        caption="Hello world",
        timestamp="2026-01-01T00:00:00",
        permalink="https://instagram.com/p/abc123",
    )
    post = db.get_post("abc123")
    assert post["caption"] == "Hello world"
    assert post["type"] == "post"


def test_insert_media(db):
    db.upsert_account("testuser", None)
    db.insert_post(
        id="abc123",
        username="testuser",
        post_type="post",
        caption="",
        timestamp="2026-01-01T00:00:00",
        permalink="",
    )
    db.insert_media(
        post_id="abc123",
        media_type="image",
        file_path="testuser/abc123/1.jpg",
        thumbnail_path="testuser/abc123/1_thumb.jpg",
        order=0,
    )
    media = db.get_media_for_post("abc123")
    assert len(media) == 1
    assert media[0]["media_type"] == "image"


def test_get_feed_paginated(db):
    db.upsert_account("testuser", None)
    for i in range(5):
        db.insert_post(
            id=f"post_{i}",
            username="testuser",
            post_type="post",
            caption=f"Post {i}",
            timestamp=f"2026-01-0{i+1}T00:00:00",
            permalink="",
        )
    page = db.get_feed(limit=2, offset=0)
    assert len(page) == 2
    # Newest first
    assert page[0]["id"] == "post_4"


def test_config_get_set(db):
    db.set_config("cron_schedule", "0 8 * * *")
    assert db.get_config("cron_schedule") == "0 8 * * *"
    db.set_config("cron_schedule", "0 9 * * *")
    assert db.get_config("cron_schedule") == "0 9 * * *"


def test_insert_scrape_run(db):
    run_id = db.insert_scrape_run()
    db.finish_scrape_run(run_id, status="success", new_posts=3, new_stories=1)
    run = db.get_scrape_run(run_id)
    assert run["status"] == "success"
    assert run["new_posts_count"] == 3
```

**Step 2: Run test to verify it fails**

Run: `cd scraper && python -m pytest tests/test_db.py -v`
Expected: FAIL - ModuleNotFoundError

**Step 3: Write implementation**

```python
# scraper/src/__init__.py
# (empty)

# scraper/tests/__init__.py
# (empty)

# scraper/src/db.py
import sqlite3
from datetime import datetime, timezone


class Database:
    def __init__(self, db_path: str):
        self.db_path = db_path
        self._conn = None

    @property
    def conn(self) -> sqlite3.Connection:
        if self._conn is None:
            self._conn = sqlite3.connect(self.db_path)
            self._conn.row_factory = sqlite3.Row
            self._conn.execute("PRAGMA journal_mode=WAL")
            self._conn.execute("PRAGMA foreign_keys=ON")
        return self._conn

    def execute(self, sql: str, params=()) -> sqlite3.Cursor:
        return self.conn.execute(sql, params)

    def initialize(self):
        self.conn.executescript("""
            CREATE TABLE IF NOT EXISTS accounts (
                username TEXT PRIMARY KEY,
                profile_pic_path TEXT,
                last_checked_at DATETIME,
                added_at DATETIME DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS posts (
                id TEXT PRIMARY KEY,
                username TEXT NOT NULL REFERENCES accounts(username),
                type TEXT NOT NULL CHECK(type IN ('post', 'reel', 'story')),
                caption TEXT,
                timestamp DATETIME,
                permalink TEXT,
                created_at DATETIME DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS media (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                post_id TEXT NOT NULL REFERENCES posts(id),
                media_type TEXT NOT NULL CHECK(media_type IN ('image', 'video')),
                file_path TEXT NOT NULL,
                thumbnail_path TEXT,
                "order" INTEGER DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS config (
                key TEXT PRIMARY KEY,
                value TEXT
            );

            CREATE TABLE IF NOT EXISTS scrape_runs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                started_at DATETIME DEFAULT (datetime('now')),
                finished_at DATETIME,
                status TEXT,
                new_posts_count INTEGER DEFAULT 0,
                new_stories_count INTEGER DEFAULT 0
            );
        """)

    def upsert_account(self, username: str, profile_pic_path: str | None):
        self.execute(
            """INSERT INTO accounts (username, profile_pic_path)
               VALUES (?, ?)
               ON CONFLICT(username) DO UPDATE SET profile_pic_path=excluded.profile_pic_path""",
            (username, profile_pic_path),
        )
        self.conn.commit()

    def get_account(self, username: str) -> dict | None:
        row = self.execute("SELECT * FROM accounts WHERE username=?", (username,)).fetchone()
        return dict(row) if row else None

    def get_all_accounts(self) -> list[dict]:
        rows = self.execute("SELECT * FROM accounts ORDER BY username").fetchall()
        return [dict(r) for r in rows]

    def update_last_checked(self, username: str):
        self.execute(
            "UPDATE accounts SET last_checked_at=datetime('now') WHERE username=?",
            (username,),
        )
        self.conn.commit()

    def insert_post(self, id: str, username: str, post_type: str, caption: str,
                    timestamp: str, permalink: str) -> bool:
        try:
            self.execute(
                """INSERT INTO posts (id, username, type, caption, timestamp, permalink)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (id, username, post_type, caption, timestamp, permalink),
            )
            self.conn.commit()
            return True
        except sqlite3.IntegrityError:
            return False  # Already exists

    def get_post(self, post_id: str) -> dict | None:
        row = self.execute("SELECT * FROM posts WHERE id=?", (post_id,)).fetchone()
        return dict(row) if row else None

    def insert_media(self, post_id: str, media_type: str, file_path: str,
                     thumbnail_path: str | None, order: int = 0):
        self.execute(
            """INSERT INTO media (post_id, media_type, file_path, thumbnail_path, "order")
               VALUES (?, ?, ?, ?, ?)""",
            (post_id, media_type, file_path, thumbnail_path, order),
        )
        self.conn.commit()

    def get_media_for_post(self, post_id: str) -> list[dict]:
        rows = self.execute(
            'SELECT * FROM media WHERE post_id=? ORDER BY "order"', (post_id,)
        ).fetchall()
        return [dict(r) for r in rows]

    def get_feed(self, limit: int = 20, offset: int = 0,
                 account: str | None = None) -> list[dict]:
        if account:
            rows = self.execute(
                "SELECT * FROM posts WHERE username=? ORDER BY timestamp DESC LIMIT ? OFFSET ?",
                (account, limit, offset),
            ).fetchall()
        else:
            rows = self.execute(
                "SELECT * FROM posts ORDER BY timestamp DESC LIMIT ? OFFSET ?",
                (limit, offset),
            ).fetchall()
        return [dict(r) for r in rows]

    def get_new_posts_since(self, since: str) -> list[dict]:
        rows = self.execute(
            "SELECT * FROM posts WHERE created_at > ? ORDER BY timestamp DESC",
            (since,),
        ).fetchall()
        return [dict(r) for r in rows]

    def set_config(self, key: str, value: str):
        self.execute(
            "INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (key, value),
        )
        self.conn.commit()

    def get_config(self, key: str) -> str | None:
        row = self.execute("SELECT value FROM config WHERE key=?", (key,)).fetchone()
        return row["value"] if row else None

    def insert_scrape_run(self) -> int:
        cursor = self.execute("INSERT INTO scrape_runs DEFAULT VALUES")
        self.conn.commit()
        return cursor.lastrowid

    def finish_scrape_run(self, run_id: int, status: str,
                          new_posts: int = 0, new_stories: int = 0):
        self.execute(
            """UPDATE scrape_runs
               SET finished_at=datetime('now'), status=?, new_posts_count=?, new_stories_count=?
               WHERE id=?""",
            (status, new_posts, new_stories, run_id),
        )
        self.conn.commit()

    def get_scrape_run(self, run_id: int) -> dict | None:
        row = self.execute("SELECT * FROM scrape_runs WHERE id=?", (run_id,)).fetchone()
        return dict(row) if row else None

    def close(self):
        if self._conn:
            self._conn.close()
            self._conn = None
```

**Step 4: Run tests to verify they pass**

Run: `cd scraper && python -m pytest tests/test_db.py -v`
Expected: All PASS

**Step 5: Commit**

```bash
git add scraper/src/ scraper/tests/
git commit -m "feat: SQLite database layer with full CRUD for accounts, posts, media, config"
```

---

### Task 3: Cookie Encryption & Validation

**Files:**
- Create: `scraper/src/cookies.py`
- Create: `scraper/tests/test_cookies.py`

**Step 1: Write the failing test**

```python
# scraper/tests/test_cookies.py
import os
import tempfile
import pytest
from src.cookies import CookieManager
from src.db import Database


@pytest.fixture
def db():
    with tempfile.TemporaryDirectory() as tmpdir:
        db_path = os.path.join(tmpdir, "test.db")
        database = Database(db_path)
        database.initialize()
        yield database


@pytest.fixture
def cookie_manager(db):
    key = "a" * 64  # 32-byte hex key
    return CookieManager(db, key)


def test_store_and_retrieve_cookies(cookie_manager):
    cookies = {
        "sessionid": "abc123",
        "csrftoken": "token456",
        "ds_user_id": "789",
    }
    cookie_manager.store_cookies(cookies)
    retrieved = cookie_manager.get_cookies()
    assert retrieved == cookies


def test_cookies_stored_encrypted(cookie_manager, db):
    cookies = {"sessionid": "abc123"}
    cookie_manager.store_cookies(cookies)
    raw = db.get_config("ig_cookies")
    assert "abc123" not in raw  # Must be encrypted


def test_get_cookies_returns_none_when_empty(cookie_manager):
    assert cookie_manager.get_cookies() is None


def test_mark_stale_and_check(cookie_manager):
    cookies = {"sessionid": "abc123"}
    cookie_manager.store_cookies(cookies)
    assert cookie_manager.is_stale() is False
    cookie_manager.mark_stale()
    assert cookie_manager.is_stale() is True


def test_storing_new_cookies_clears_stale(cookie_manager):
    cookie_manager.store_cookies({"sessionid": "abc123"})
    cookie_manager.mark_stale()
    assert cookie_manager.is_stale() is True
    cookie_manager.store_cookies({"sessionid": "new456"})
    assert cookie_manager.is_stale() is False
```

**Step 2: Run test to verify it fails**

Run: `cd scraper && python -m pytest tests/test_cookies.py -v`
Expected: FAIL

**Step 3: Write implementation**

```python
# scraper/src/cookies.py
import json
from cryptography.fernet import Fernet
from base64 import urlsafe_b64encode
from hashlib import sha256
from src.db import Database


class CookieManager:
    def __init__(self, db: Database, encryption_key: str):
        self.db = db
        # Derive a Fernet-compatible key from the hex key
        key_bytes = sha256(bytes.fromhex(encryption_key)).digest()
        self._fernet = Fernet(urlsafe_b64encode(key_bytes))

    def store_cookies(self, cookies: dict[str, str]):
        plaintext = json.dumps(cookies)
        encrypted = self._fernet.encrypt(plaintext.encode()).decode()
        self.db.set_config("ig_cookies", encrypted)
        self.db.set_config("ig_cookies_stale", "false")

    def get_cookies(self) -> dict[str, str] | None:
        encrypted = self.db.get_config("ig_cookies")
        if not encrypted:
            return None
        plaintext = self._fernet.decrypt(encrypted.encode()).decode()
        return json.loads(plaintext)

    def mark_stale(self):
        self.db.set_config("ig_cookies_stale", "true")

    def is_stale(self) -> bool:
        return self.db.get_config("ig_cookies_stale") == "true"
```

**Step 4: Run tests**

Run: `cd scraper && python -m pytest tests/test_cookies.py -v`
Expected: All PASS

**Step 5: Commit**

```bash
git add scraper/src/cookies.py scraper/tests/test_cookies.py
git commit -m "feat: cookie encryption, storage, and staleness tracking"
```

---

### Task 4: Instagram Client Wrapper

**Files:**
- Create: `scraper/src/instagram.py`
- Create: `scraper/tests/test_instagram.py`

**Step 1: Write the failing test**

```python
# scraper/tests/test_instagram.py
from unittest.mock import MagicMock, patch
import pytest
from src.instagram import InstagramClient


def test_validate_session_returns_true_on_success():
    client = InstagramClient.__new__(InstagramClient)
    client._cl = MagicMock()
    client._cl.account_info.return_value = MagicMock(username="testuser")
    assert client.validate_session() is True


def test_validate_session_returns_false_on_failure():
    client = InstagramClient.__new__(InstagramClient)
    client._cl = MagicMock()
    client._cl.account_info.side_effect = Exception("Login required")
    assert client.validate_session() is False


def test_get_following_returns_usernames():
    client = InstagramClient.__new__(InstagramClient)
    client._cl = MagicMock()
    user_mock = MagicMock()
    user_mock.pk = 123
    client._cl.account_info.return_value = user_mock
    following_mock = MagicMock()
    following_mock.username = "followed_user"
    client._cl.user_following.return_value = {1: following_mock}
    result = client.get_following()
    assert result == [{"username": "followed_user", "pk": 1}]


def test_get_user_posts():
    client = InstagramClient.__new__(InstagramClient)
    client._cl = MagicMock()
    post_mock = MagicMock()
    post_mock.pk = "post123"
    post_mock.caption_text = "Hello"
    post_mock.taken_at = "2026-01-01T00:00:00"
    post_mock.code = "abc"
    post_mock.media_type = 1  # photo
    post_mock.resources = []
    post_mock.thumbnail_url = "https://example.com/thumb.jpg"
    post_mock.video_url = None

    user_mock = MagicMock()
    user_mock.pk = 456
    client._cl.user_id_from_username.return_value = 456
    client._cl.user_medias.return_value = [post_mock]

    result = client.get_user_posts("testuser", amount=1)
    assert len(result) == 1
    assert result[0]["id"] == "post123"
```

**Step 2: Run test to verify it fails**

Run: `cd scraper && python -m pytest tests/test_instagram.py -v`
Expected: FAIL

**Step 3: Write implementation**

```python
# scraper/src/instagram.py
import time
import random
from instagrapi import Client
from instagrapi.exceptions import LoginRequired, ClientError


class InstagramClient:
    def __init__(self, cookies: dict[str, str]):
        self._cl = Client()
        self._cl.set_settings({})
        # Set session cookies directly
        self._cl.set_cookies(cookies)

    def validate_session(self) -> bool:
        try:
            self._cl.account_info()
            return True
        except Exception:
            return False

    def get_following(self) -> list[dict]:
        user = self._cl.account_info()
        following = self._cl.user_following(user.pk)
        return [
            {"username": u.username, "pk": pk}
            for pk, u in following.items()
        ]

    def get_user_posts(self, username: str, amount: int = 20) -> list[dict]:
        user_id = self._cl.user_id_from_username(username)
        medias = self._cl.user_medias(user_id, amount=amount)
        posts = []
        for m in medias:
            media_items = []
            if m.resources:  # Carousel
                for i, r in enumerate(m.resources):
                    media_items.append({
                        "type": "video" if r.video_url else "image",
                        "url": str(r.video_url or r.thumbnail_url),
                        "order": i,
                    })
            else:
                media_items.append({
                    "type": "video" if m.video_url else "image",
                    "url": str(m.video_url or m.thumbnail_url),
                    "order": 0,
                })
            posts.append({
                "id": str(m.pk),
                "caption": m.caption_text or "",
                "timestamp": str(m.taken_at),
                "permalink": f"https://www.instagram.com/p/{m.code}/",
                "post_type": "reel" if m.media_type == 2 and m.video_url else "post",
                "media": media_items,
            })
        return posts

    def get_user_stories(self, username: str) -> list[dict]:
        user_id = self._cl.user_id_from_username(username)
        stories = self._cl.user_stories(user_id)
        result = []
        for s in stories:
            result.append({
                "id": str(s.pk),
                "caption": "",
                "timestamp": str(s.taken_at),
                "permalink": f"https://www.instagram.com/stories/{username}/{s.pk}/",
                "post_type": "story",
                "media": [{
                    "type": "video" if s.video_url else "image",
                    "url": str(s.video_url or s.thumbnail_url),
                    "order": 0,
                }],
            })
        return result

    def get_user_profile_pic(self, username: str) -> str:
        user_id = self._cl.user_id_from_username(username)
        info = self._cl.user_info(user_id)
        return str(info.profile_pic_url)

    @staticmethod
    def random_delay(min_s: float = 1.0, max_s: float = 3.0):
        time.sleep(random.uniform(min_s, max_s))
```

**Step 4: Run tests**

Run: `cd scraper && python -m pytest tests/test_instagram.py -v`
Expected: All PASS

**Step 5: Commit**

```bash
git add scraper/src/instagram.py scraper/tests/test_instagram.py
git commit -m "feat: Instagram client wrapper with posts, stories, and session validation"
```

---

### Task 5: Media Downloader

**Files:**
- Create: `scraper/src/downloader.py`
- Create: `scraper/tests/test_downloader.py`

**Step 1: Write the failing test**

```python
# scraper/tests/test_downloader.py
import os
import tempfile
from unittest.mock import patch, MagicMock
import pytest
from src.downloader import MediaDownloader


@pytest.fixture
def media_dir():
    with tempfile.TemporaryDirectory() as tmpdir:
        yield tmpdir


def test_download_creates_directory_structure(media_dir):
    downloader = MediaDownloader(media_dir)
    with patch("src.downloader.requests.get") as mock_get:
        mock_response = MagicMock()
        mock_response.content = b"fake image data"
        mock_response.headers = {"content-type": "image/jpeg"}
        mock_get.return_value = mock_response

        path = downloader.download("https://example.com/photo.jpg", "testuser", "post123", 0)

    assert os.path.exists(os.path.join(media_dir, path))
    assert "testuser" in path
    assert "post123" in path


def test_download_creates_thumbnail(media_dir):
    downloader = MediaDownloader(media_dir)
    with patch("src.downloader.requests.get") as mock_get, \
         patch("src.downloader.Image") as mock_image:
        mock_response = MagicMock()
        mock_response.content = b"fake image data"
        mock_response.headers = {"content-type": "image/jpeg"}
        mock_get.return_value = mock_response

        mock_img = MagicMock()
        mock_image.open.return_value = mock_img

        path, thumb_path = downloader.download_with_thumbnail(
            "https://example.com/photo.jpg", "testuser", "post123", 0
        )

    assert thumb_path is not None
    mock_img.thumbnail.assert_called_once()


def test_skip_download_if_exists(media_dir):
    downloader = MediaDownloader(media_dir)
    # Create the file manually
    os.makedirs(os.path.join(media_dir, "testuser", "post123"), exist_ok=True)
    filepath = os.path.join(media_dir, "testuser", "post123", "0.jpg")
    with open(filepath, "w") as f:
        f.write("existing")

    with patch("src.downloader.requests.get") as mock_get:
        path = downloader.download("https://example.com/photo.jpg", "testuser", "post123", 0)

    mock_get.assert_not_called()  # Should skip
```

**Step 2: Run test to verify it fails**

Run: `cd scraper && python -m pytest tests/test_downloader.py -v`
Expected: FAIL

**Step 3: Write implementation**

```python
# scraper/src/downloader.py
import os
import requests
from PIL import Image
from io import BytesIO

THUMBNAIL_SIZE = (400, 400)


class MediaDownloader:
    def __init__(self, media_dir: str):
        self.media_dir = media_dir

    def _get_extension(self, url: str, content_type: str = "") -> str:
        if "video" in content_type or url.split("?")[0].endswith(".mp4"):
            return ".mp4"
        return ".jpg"

    def _build_path(self, username: str, post_id: str, order: int, ext: str) -> str:
        return os.path.join(username, post_id, f"{order}{ext}")

    def download(self, url: str, username: str, post_id: str, order: int) -> str:
        rel_path = self._build_path(username, post_id, order, self._get_extension(url))
        full_path = os.path.join(self.media_dir, rel_path)

        if os.path.exists(full_path):
            return rel_path

        os.makedirs(os.path.dirname(full_path), exist_ok=True)
        response = requests.get(url, timeout=30)
        with open(full_path, "wb") as f:
            f.write(response.content)

        return rel_path

    def download_with_thumbnail(self, url: str, username: str, post_id: str,
                                 order: int) -> tuple[str, str | None]:
        rel_path = self.download(url, username, post_id, order)
        full_path = os.path.join(self.media_dir, rel_path)

        # Only create thumbnails for images
        if rel_path.endswith(".mp4"):
            return rel_path, None

        thumb_rel = rel_path.replace(".jpg", "_thumb.jpg")
        thumb_full = os.path.join(self.media_dir, thumb_rel)

        if not os.path.exists(thumb_full):
            try:
                img = Image.open(full_path)
                img.thumbnail(THUMBNAIL_SIZE)
                img.save(thumb_full, "JPEG", quality=80)
            except Exception:
                return rel_path, None

        return rel_path, thumb_rel
```

**Step 4: Run tests**

Run: `cd scraper && python -m pytest tests/test_downloader.py -v`
Expected: All PASS

**Step 5: Commit**

```bash
git add scraper/src/downloader.py scraper/tests/test_downloader.py
git commit -m "feat: media downloader with thumbnail generation and deduplication"
```

---

### Task 6: Email Digest Builder

**Files:**
- Create: `scraper/src/digest.py`
- Create: `scraper/templates/digest.html`
- Create: `scraper/tests/test_digest.py`

**Step 1: Write the failing test**

```python
# scraper/tests/test_digest.py
from unittest.mock import patch, MagicMock
import pytest
from src.digest import DigestBuilder


@pytest.fixture
def builder():
    return DigestBuilder(
        resend_api_key="re_test_key",
        base_url="https://ig.raakode.dk",
        from_email="digest@ig.raakode.dk",
    )


def test_build_html_contains_posts(builder):
    posts = [
        {
            "id": "post1",
            "username": "user1",
            "type": "post",
            "caption": "Hello world",
            "timestamp": "2026-01-01T00:00:00",
            "media": [{"thumbnail_path": "user1/post1/0_thumb.jpg", "media_type": "image"}],
        }
    ]
    html = builder.build_html(posts)
    assert "Hello world" in html
    assert "user1" in html
    assert "ig.raakode.dk" in html


def test_build_html_groups_by_account(builder):
    posts = [
        {"id": "p1", "username": "alice", "type": "post", "caption": "A",
         "timestamp": "2026-01-01T00:00:00", "media": []},
        {"id": "p2", "username": "bob", "type": "post", "caption": "B",
         "timestamp": "2026-01-01T01:00:00", "media": []},
        {"id": "p3", "username": "alice", "type": "story", "caption": "",
         "timestamp": "2026-01-01T02:00:00", "media": []},
    ]
    html = builder.build_html(posts)
    assert "alice" in html
    assert "bob" in html


def test_send_digest_calls_resend(builder):
    with patch("src.digest.resend") as mock_resend:
        mock_resend.Emails.send.return_value = {"id": "email123"}
        builder.send("test@example.com", "<h1>Digest</h1>", post_count=3)
        mock_resend.Emails.send.assert_called_once()
        call_args = mock_resend.Emails.send.call_args[1]
        assert call_args["to"] == ["test@example.com"]
        assert "3" in call_args["subject"]
```

**Step 2: Run test to verify it fails**

Run: `cd scraper && python -m pytest tests/test_digest.py -v`
Expected: FAIL

**Step 3: Create email template**

```html
<!-- scraper/templates/digest.html -->
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 600px; margin: 0 auto; padding: 16px; background: #fafafa; }
    .account-section { margin-bottom: 24px; }
    .account-name { font-size: 16px; font-weight: 600; margin-bottom: 8px; color: #262626; }
    .post-card { background: white; border: 1px solid #dbdbdb; border-radius: 8px; margin-bottom: 12px; overflow: hidden; }
    .post-card img { width: 100%; max-width: 400px; display: block; }
    .post-body { padding: 12px; }
    .post-caption { font-size: 14px; color: #262626; margin-bottom: 8px; }
    .post-meta { font-size: 12px; color: #8e8e8e; }
    .post-link { color: #0095f6; text-decoration: none; font-size: 13px; }
    .badge { display: inline-block; font-size: 11px; padding: 2px 6px; border-radius: 4px; background: #efefef; color: #666; margin-right: 4px; }
    .footer { margin-top: 24px; padding-top: 16px; border-top: 1px solid #dbdbdb; font-size: 12px; color: #8e8e8e; }
  </style>
</head>
<body>
  <h2 style="color: #262626;">Instagram Digest</h2>
  <p style="color: #8e8e8e; font-size: 13px;">{{ post_count }} new item{{ 's' if post_count != 1 else '' }} from {{ account_count }} account{{ 's' if account_count != 1 else '' }}</p>

  {% for username, posts in grouped_posts.items() %}
  <div class="account-section">
    <div class="account-name">@{{ username }}</div>
    {% for post in posts %}
    <div class="post-card">
      {% if post.media and post.media[0].thumbnail_path %}
      <img src="{{ base_url }}/api/media/{{ post.media[0].thumbnail_path }}" alt="">
      {% endif %}
      <div class="post-body">
        <span class="badge">{{ post.type }}</span>
        {% if post.caption %}
        <p class="post-caption">{{ post.caption[:200] }}{% if post.caption|length > 200 %}...{% endif %}</p>
        {% endif %}
        <div class="post-meta">{{ post.timestamp }}</div>
        {% if post.type == 'story' %}
        <a class="post-link" href="{{ base_url }}/story/{{ post.id }}">View in feed &rarr;</a>
        {% else %}
        <a class="post-link" href="{{ base_url }}/post/{{ post.id }}">View in feed &rarr;</a>
        {% endif %}
      </div>
    </div>
    {% endfor %}
  </div>
  {% endfor %}

  <div class="footer">
    You're following {{ account_count }} accounts.
    <a href="{{ base_url }}/settings">Manage settings</a>
  </div>
</body>
</html>
```

**Step 4: Write implementation**

```python
# scraper/src/digest.py
import os
from collections import defaultdict
from jinja2 import Environment, FileSystemLoader
import resend


class DigestBuilder:
    def __init__(self, resend_api_key: str, base_url: str, from_email: str = "digest@ig.raakode.dk"):
        self.base_url = base_url
        self.from_email = from_email
        resend.api_key = resend_api_key

        template_dir = os.path.join(os.path.dirname(__file__), "..", "templates")
        self._env = Environment(loader=FileSystemLoader(template_dir))

    def build_html(self, posts: list[dict]) -> str:
        grouped = defaultdict(list)
        for post in posts:
            grouped[post["username"]].append(post)

        template = self._env.get_template("digest.html")
        return template.render(
            grouped_posts=dict(grouped),
            post_count=len(posts),
            account_count=len(grouped),
            base_url=self.base_url,
        )

    def send(self, to_email: str, html: str, post_count: int):
        resend.Emails.send(
            from_=self.from_email,
            to=[to_email],
            subject=f"Instagram Digest: {post_count} new item{'s' if post_count != 1 else ''}",
            html=html,
        )

    def send_stale_cookies_alert(self, to_email: str):
        html = f"""
        <h2>Instagram Cookies Expired</h2>
        <p>Your Instagram session cookies have expired. The scraper can't fetch new content until you update them.</p>
        <p><a href="{self.base_url}/settings">Update cookies &rarr;</a></p>
        """
        resend.Emails.send(
            from_=self.from_email,
            to=[to_email],
            subject="ig-sub: Instagram cookies expired",
            html=html,
        )
```

**Step 5: Run tests**

Run: `cd scraper && python -m pytest tests/test_digest.py -v`
Expected: All PASS

**Step 6: Commit**

```bash
git add scraper/src/digest.py scraper/templates/ scraper/tests/test_digest.py
git commit -m "feat: email digest builder with Jinja2 templates and Resend integration"
```

---

### Task 7: Core Scrape Logic

**Files:**
- Create: `scraper/src/scrape.py`
- Create: `scraper/tests/test_scrape.py`

**Step 1: Write the failing test**

```python
# scraper/tests/test_scrape.py
import os
import tempfile
from unittest.mock import MagicMock, patch
import pytest
from src.db import Database
from src.scrape import Scraper


@pytest.fixture
def env():
    with tempfile.TemporaryDirectory() as tmpdir:
        db_path = os.path.join(tmpdir, "test.db")
        media_dir = os.path.join(tmpdir, "media")
        os.makedirs(media_dir)
        db = Database(db_path)
        db.initialize()
        yield db, media_dir


def test_scrape_account_stores_posts(env):
    db, media_dir = env
    db.upsert_account("testuser", None)

    mock_ig = MagicMock()
    mock_ig.get_user_posts.return_value = [
        {
            "id": "p1",
            "caption": "Hello",
            "timestamp": "2026-01-01T00:00:00",
            "permalink": "https://instagram.com/p/abc",
            "post_type": "post",
            "media": [{"type": "image", "url": "https://example.com/img.jpg", "order": 0}],
        }
    ]
    mock_ig.get_user_stories.return_value = []

    mock_downloader = MagicMock()
    mock_downloader.download_with_thumbnail.return_value = ("testuser/p1/0.jpg", "testuser/p1/0_thumb.jpg")

    scraper = Scraper(db=db, ig_client=mock_ig, downloader=mock_downloader)
    new_posts, new_stories = scraper.scrape_account("testuser")

    assert new_posts == 1
    assert new_stories == 0
    assert db.get_post("p1") is not None


def test_scrape_account_skips_existing_posts(env):
    db, media_dir = env
    db.upsert_account("testuser", None)
    db.insert_post("p1", "testuser", "post", "Old", "2026-01-01T00:00:00", "")

    mock_ig = MagicMock()
    mock_ig.get_user_posts.return_value = [
        {
            "id": "p1",
            "caption": "Old",
            "timestamp": "2026-01-01T00:00:00",
            "permalink": "",
            "post_type": "post",
            "media": [],
        }
    ]
    mock_ig.get_user_stories.return_value = []
    mock_downloader = MagicMock()

    scraper = Scraper(db=db, ig_client=mock_ig, downloader=mock_downloader)
    new_posts, new_stories = scraper.scrape_account("testuser")

    assert new_posts == 0
    mock_downloader.download_with_thumbnail.assert_not_called()


def test_scrape_all_returns_totals(env):
    db, media_dir = env
    db.upsert_account("user1", None)
    db.upsert_account("user2", None)

    mock_ig = MagicMock()
    mock_ig.get_user_posts.return_value = [
        {
            "id": "unique_id",
            "caption": "Hi",
            "timestamp": "2026-01-01T00:00:00",
            "permalink": "",
            "post_type": "post",
            "media": [],
        }
    ]
    mock_ig.get_user_stories.return_value = []
    mock_ig.random_delay = MagicMock()
    mock_downloader = MagicMock()
    mock_downloader.download_with_thumbnail.return_value = ("path", None)

    scraper = Scraper(db=db, ig_client=mock_ig, downloader=mock_downloader)

    # Second call will try to insert same id and get skipped
    total_posts, total_stories = scraper.scrape_all()
    assert total_posts >= 1
```

**Step 2: Run test to verify it fails**

Run: `cd scraper && python -m pytest tests/test_scrape.py -v`
Expected: FAIL

**Step 3: Write implementation**

```python
# scraper/src/scrape.py
import logging
from src.db import Database
from src.instagram import InstagramClient
from src.downloader import MediaDownloader

logger = logging.getLogger(__name__)


class Scraper:
    def __init__(self, db: Database, ig_client: InstagramClient, downloader: MediaDownloader):
        self.db = db
        self.ig = ig_client
        self.downloader = downloader

    def scrape_account(self, username: str) -> tuple[int, int]:
        new_posts = 0
        new_stories = 0

        # Fetch posts
        posts = self.ig.get_user_posts(username, amount=20)
        for post in posts:
            was_new = self._process_post(post, username)
            if was_new:
                new_posts += 1

        # Fetch stories
        stories = self.ig.get_user_stories(username)
        for story in stories:
            was_new = self._process_post(story, username)
            if was_new:
                new_stories += 1

        self.db.update_last_checked(username)
        return new_posts, new_stories

    def _process_post(self, post_data: dict, username: str) -> bool:
        post_id = post_data["id"]

        # Skip if already exists
        if self.db.get_post(post_id):
            return False

        # Download media
        for item in post_data.get("media", []):
            file_path, thumb_path = self.downloader.download_with_thumbnail(
                url=item["url"],
                username=username,
                post_id=post_id,
                order=item["order"],
            )
            # We'll insert media after the post
            item["file_path"] = file_path
            item["thumbnail_path"] = thumb_path

        # Insert post
        self.db.insert_post(
            id=post_id,
            username=username,
            post_type=post_data["post_type"],
            caption=post_data["caption"],
            timestamp=post_data["timestamp"],
            permalink=post_data["permalink"],
        )

        # Insert media records
        for item in post_data.get("media", []):
            self.db.insert_media(
                post_id=post_id,
                media_type=item["type"],
                file_path=item.get("file_path", ""),
                thumbnail_path=item.get("thumbnail_path"),
                order=item["order"],
            )

        return True

    def scrape_all(self) -> tuple[int, int]:
        accounts = self.db.get_all_accounts()
        total_posts = 0
        total_stories = 0

        for account in accounts:
            username = account["username"]
            try:
                logger.info(f"Scraping {username}...")
                posts, stories = self.scrape_account(username)
                total_posts += posts
                total_stories += stories
                logger.info(f"  {username}: {posts} new posts, {stories} new stories")
                self.ig.random_delay()
            except Exception as e:
                logger.error(f"  Error scraping {username}: {e}")

        return total_posts, total_stories

    def sync_following(self):
        """Refresh the accounts list from Instagram."""
        following = self.ig.get_following()
        for user in following:
            profile_pic_url = self.ig.get_user_profile_pic(user["username"])
            file_path = self.downloader.download(
                url=profile_pic_url,
                username=user["username"],
                post_id="_profile",
                order=0,
            )
            self.db.upsert_account(user["username"], file_path)
            self.ig.random_delay(0.5, 1.5)
```

**Step 4: Run tests**

Run: `cd scraper && python -m pytest tests/test_scrape.py -v`
Expected: All PASS

**Step 5: Commit**

```bash
git add scraper/src/scrape.py scraper/tests/test_scrape.py
git commit -m "feat: core scrape logic with media download and deduplication"
```

---

### Task 8: Main Entry Point & Scheduler

**Files:**
- Create: `scraper/src/config.py`
- Create: `scraper/src/main.py`

**Step 1: Write config module**

```python
# scraper/src/config.py
import os


class Config:
    DATABASE_PATH = os.environ.get("DATABASE_PATH", "/data/db/ig.db")
    MEDIA_PATH = os.environ.get("MEDIA_PATH", "/data/media")
    ENCRYPTION_KEY = os.environ.get("ENCRYPTION_KEY", "")
    RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "")
    EMAIL_RECIPIENT = os.environ.get("EMAIL_RECIPIENT", "")
    CRON_SCHEDULE = os.environ.get("CRON_SCHEDULE", "0 8 * * *")
    BASE_URL = os.environ.get("BASE_URL", "https://ig.raakode.dk")
```

**Step 2: Write main entry point**

```python
# scraper/src/main.py
import logging
import signal
import sys
import time
from apscheduler.schedulers.blocking import BlockingScheduler
from apscheduler.triggers.cron import CronTrigger

from src.config import Config
from src.db import Database
from src.cookies import CookieManager
from src.instagram import InstagramClient
from src.downloader import MediaDownloader
from src.scrape import Scraper
from src.digest import DigestBuilder

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


def run_scrape():
    logger.info("Starting scrape run...")
    config = Config()
    db = Database(config.DATABASE_PATH)
    db.initialize()

    cookie_mgr = CookieManager(db, config.ENCRYPTION_KEY)
    cookies = cookie_mgr.get_cookies()

    digest = DigestBuilder(
        resend_api_key=config.RESEND_API_KEY,
        base_url=config.BASE_URL,
    )

    if not cookies:
        logger.warning("No cookies configured. Skipping.")
        return

    # Validate session
    ig = InstagramClient(cookies)
    if not ig.validate_session():
        logger.warning("Cookies are stale!")
        cookie_mgr.mark_stale()
        if config.EMAIL_RECIPIENT:
            digest.send_stale_cookies_alert(config.EMAIL_RECIPIENT)
        return

    run_id = db.insert_scrape_run()
    downloader = MediaDownloader(config.MEDIA_PATH)
    scraper = Scraper(db=db, ig_client=ig, downloader=downloader)

    try:
        # Sync following list periodically (check if we have any accounts)
        accounts = db.get_all_accounts()
        if not accounts:
            logger.info("No accounts found. Syncing following list...")
            scraper.sync_following()

        total_posts, total_stories = scraper.scrape_all()
        db.finish_scrape_run(run_id, "success", total_posts, total_stories)
        logger.info(f"Scrape complete: {total_posts} posts, {total_stories} stories")

        # Send digest if there's new content
        if (total_posts + total_stories) > 0 and config.EMAIL_RECIPIENT:
            # Get posts created in this run
            run_info = db.get_scrape_run(run_id)
            new_posts = db.get_new_posts_since(run_info["started_at"])
            # Enrich with media
            for post in new_posts:
                post["media"] = db.get_media_for_post(post["id"])
            html = digest.build_html(new_posts)
            digest.send(config.EMAIL_RECIPIENT, html, total_posts + total_stories)
            logger.info("Digest email sent.")

    except Exception as e:
        logger.error(f"Scrape failed: {e}")
        db.finish_scrape_run(run_id, "error")

    db.close()


def main():
    config = Config()

    # Initialize DB on startup
    db = Database(config.DATABASE_PATH)
    db.initialize()

    # Set initial config defaults
    if not db.get_config("cron_schedule"):
        db.set_config("cron_schedule", config.CRON_SCHEDULE)
    db.close()

    # Read cron from DB (may have been updated via web UI)
    db = Database(config.DATABASE_PATH)
    cron_expr = db.get_config("cron_schedule") or config.CRON_SCHEDULE
    db.close()

    logger.info(f"Starting scheduler with cron: {cron_expr}")

    scheduler = BlockingScheduler()
    scheduler.add_job(
        run_scrape,
        CronTrigger.from_crontab(cron_expr),
        id="scrape_job",
        name="Instagram Scrape",
        misfire_grace_time=3600,
    )

    # Run once on startup
    logger.info("Running initial scrape...")
    run_scrape()

    def shutdown(signum, frame):
        logger.info("Shutting down...")
        scheduler.shutdown(wait=False)
        sys.exit(0)

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)

    scheduler.start()


if __name__ == "__main__":
    main()
```

**Step 3: Commit**

```bash
git add scraper/src/config.py scraper/src/main.py
git commit -m "feat: main entry point with APScheduler cron-based scheduling"
```

---

### Task 9: Next.js Project Setup

**Files:**
- Create: `web/` (via create-next-app)
- Modify: `web/next.config.js` for standalone output
- Add: shadcn/ui, better-sqlite3, tailwind

**Step 1: Scaffold Next.js app**

```bash
cd web
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm
```

**Step 2: Configure standalone output**

Update `web/next.config.js`:
```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
};

module.exports = nextConfig;
```

**Step 3: Install dependencies**

```bash
cd web
npm install better-sqlite3 @types/better-sqlite3
npx shadcn@latest init -d
npx shadcn@latest add button card input label badge separator avatar scroll-area
```

**Step 4: Commit**

```bash
git add web/
git commit -m "feat: Next.js project scaffold with shadcn/ui and better-sqlite3"
```

---

### Task 10: Web Database & Auth Library

**Files:**
- Create: `web/src/lib/db.ts`
- Create: `web/src/lib/auth.ts`

**Step 1: Write database helper**

```typescript
// web/src/lib/db.ts
import Database from "better-sqlite3";

const DATABASE_PATH = process.env.DATABASE_PATH || "/data/db/ig.db";

let _db: Database.Database | null = null;

function getDb(): Database.Database {
  if (!_db) {
    _db = new Database(DATABASE_PATH, { readonly: true });
    _db.pragma("journal_mode = WAL");
  }
  return _db;
}

// Writable connection for settings
function getWritableDb(): Database.Database {
  return new Database(DATABASE_PATH);
}

export interface Account {
  username: string;
  profile_pic_path: string | null;
  last_checked_at: string | null;
  added_at: string;
}

export interface Post {
  id: string;
  username: string;
  type: "post" | "reel" | "story";
  caption: string | null;
  timestamp: string;
  permalink: string;
  created_at: string;
}

export interface Media {
  id: number;
  post_id: string;
  media_type: "image" | "video";
  file_path: string;
  thumbnail_path: string | null;
  order: number;
}

export function getFeed(limit = 20, offset = 0, account?: string): Post[] {
  const db = getDb();
  if (account) {
    return db
      .prepare("SELECT * FROM posts WHERE username = ? ORDER BY timestamp DESC LIMIT ? OFFSET ?")
      .all(account, limit, offset) as Post[];
  }
  return db
    .prepare("SELECT * FROM posts ORDER BY timestamp DESC LIMIT ? OFFSET ?")
    .all(limit, offset) as Post[];
}

export function getPost(id: string): Post | undefined {
  return getDb().prepare("SELECT * FROM posts WHERE id = ?").get(id) as Post | undefined;
}

export function getMediaForPost(postId: string): Media[] {
  return getDb()
    .prepare('SELECT * FROM media WHERE post_id = ? ORDER BY "order"')
    .all(postId) as Media[];
}

export function getAccounts(): Account[] {
  return getDb().prepare("SELECT * FROM accounts ORDER BY username").all() as Account[];
}

export function getConfig(key: string): string | null {
  const row = getDb().prepare("SELECT value FROM config WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setConfig(key: string, value: string): void {
  const db = getWritableDb();
  db.prepare("INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(
    key,
    value
  );
  db.close();
}
```

**Step 2: Write auth helper**

```typescript
// web/src/lib/auth.ts
import { cookies } from "next/headers";
import { createHash, randomBytes } from "crypto";

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "changeme";
const SESSION_SECRET = process.env.ENCRYPTION_KEY || randomBytes(32).toString("hex");

function hashToken(token: string): string {
  return createHash("sha256").update(token + SESSION_SECRET).digest("hex");
}

export function createSession(): string {
  const token = randomBytes(32).toString("hex");
  // Store hash in a simple way - the token itself is the session
  return token;
}

export function validatePassword(password: string): boolean {
  return password === ADMIN_PASSWORD;
}

export async function isAuthenticated(): Promise<boolean> {
  const cookieStore = await cookies();
  const session = cookieStore.get("ig_session");
  if (!session?.value) return false;
  // Validate the session token format (exists and is hex)
  return /^[a-f0-9]{64}$/.test(session.value);
}

export async function getSessionCookie() {
  const cookieStore = await cookies();
  return cookieStore.get("ig_session");
}
```

**Step 3: Commit**

```bash
git add web/src/lib/
git commit -m "feat: web database helpers and session auth library"
```

---

### Task 11: Auth Middleware & Login Page

**Files:**
- Create: `web/src/middleware.ts`
- Create: `web/src/app/login/page.tsx`
- Create: `web/src/app/api/auth/route.ts`

**Step 1: Write middleware**

```typescript
// web/src/middleware.ts
import { NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
  const session = request.cookies.get("ig_session");
  const isLoginPage = request.nextUrl.pathname === "/login";
  const isAuthApi = request.nextUrl.pathname === "/api/auth";

  if (isLoginPage || isAuthApi) {
    return NextResponse.next();
  }

  if (!session?.value || !/^[a-f0-9]{64}$/.test(session.value)) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
```

**Step 2: Write auth API route**

```typescript
// web/src/app/api/auth/route.ts
import { NextRequest, NextResponse } from "next/server";
import { validatePassword, createSession } from "@/lib/auth";

export async function POST(request: NextRequest) {
  const { password } = await request.json();

  if (!validatePassword(password)) {
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }

  const token = createSession();
  const response = NextResponse.json({ ok: true });
  response.cookies.set("ig_session", token, {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    maxAge: 60 * 60 * 24 * 30, // 30 days
    path: "/",
  });

  return response;
}
```

**Step 3: Write login page**

```tsx
// web/src/app/login/page.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });

    if (res.ok) {
      router.push("/");
    } else {
      setError("Invalid password");
    }
    setLoading(false);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-center">ig-sub</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter admin password"
                autoFocus
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Signing in..." : "Sign in"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
```

**Step 4: Commit**

```bash
git add web/src/middleware.ts web/src/app/login/ web/src/app/api/auth/
git commit -m "feat: password auth with middleware, login page, and session cookies"
```

---

### Task 12: Feed API & Timeline Page

**Files:**
- Create: `web/src/app/api/feed/route.ts`
- Create: `web/src/app/api/accounts/route.ts`
- Create: `web/src/app/api/media/[...path]/route.ts`
- Create: `web/src/components/post-card.tsx`
- Create: `web/src/components/story-card.tsx`
- Create: `web/src/components/feed.tsx`
- Modify: `web/src/app/page.tsx`
- Modify: `web/src/app/layout.tsx`

**Step 1: Write API routes**

```typescript
// web/src/app/api/feed/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getFeed, getMediaForPost } from "@/lib/db";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get("limit") || "20");
  const offset = parseInt(searchParams.get("offset") || "0");
  const account = searchParams.get("account") || undefined;

  const posts = getFeed(limit, offset, account);
  const enriched = posts.map((post) => ({
    ...post,
    media: getMediaForPost(post.id),
  }));

  return NextResponse.json({ posts: enriched, hasMore: posts.length === limit });
}
```

```typescript
// web/src/app/api/accounts/route.ts
import { NextResponse } from "next/server";
import { getAccounts } from "@/lib/db";

export async function GET() {
  const accounts = getAccounts();
  return NextResponse.json({ accounts });
}
```

```typescript
// web/src/app/api/media/[...path]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";

const MEDIA_PATH = process.env.MEDIA_PATH || "/data/media";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path: segments } = await params;
  const filePath = path.join(MEDIA_PATH, ...segments);

  // Prevent directory traversal
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(path.resolve(MEDIA_PATH))) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  try {
    const data = await readFile(resolved);
    const ext = path.extname(resolved).toLowerCase();
    const contentType =
      ext === ".mp4" ? "video/mp4" :
      ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" :
      ext === ".png" ? "image/png" :
      "application/octet-stream";

    return new NextResponse(data, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
```

**Step 2: Write UI components**

```tsx
// web/src/components/post-card.tsx
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface PostMedia {
  id: number;
  post_id: string;
  media_type: "image" | "video";
  file_path: string;
  thumbnail_path: string | null;
  order: number;
}

interface PostCardProps {
  post: {
    id: string;
    username: string;
    type: "post" | "reel" | "story";
    caption: string | null;
    timestamp: string;
    media: PostMedia[];
  };
}

export function PostCard({ post }: PostCardProps) {
  const firstMedia = post.media[0];
  const displayPath = firstMedia?.thumbnail_path || firstMedia?.file_path;
  const detailUrl = post.type === "story" ? `/story/${post.id}` : `/post/${post.id}`;

  return (
    <Card className="overflow-hidden">
      <Link href={detailUrl}>
        {displayPath && firstMedia.media_type === "image" && (
          <img
            src={`/api/media/${displayPath}`}
            alt={post.caption || ""}
            className="w-full aspect-square object-cover"
          />
        )}
        {displayPath && firstMedia.media_type === "video" && (
          <video
            src={`/api/media/${firstMedia.file_path}`}
            className="w-full aspect-square object-cover"
            muted
            playsInline
          />
        )}
      </Link>
      <CardContent className="p-3">
        <div className="flex items-center gap-2 mb-1">
          <Link href={`/account/${post.username}`} className="text-sm font-semibold hover:underline">
            @{post.username}
          </Link>
          <Badge variant="secondary" className="text-xs">{post.type}</Badge>
          {post.media.length > 1 && (
            <Badge variant="outline" className="text-xs">{post.media.length} items</Badge>
          )}
        </div>
        {post.caption && (
          <p className="text-sm text-muted-foreground line-clamp-3">{post.caption}</p>
        )}
        <p className="text-xs text-muted-foreground mt-1">
          {new Date(post.timestamp).toLocaleDateString()}
        </p>
      </CardContent>
    </Card>
  );
}
```

```tsx
// web/src/components/feed.tsx
"use client";

import { useState, useEffect, useCallback } from "react";
import { PostCard } from "./post-card";
import { Button } from "@/components/ui/button";

interface FeedProps {
  account?: string;
}

export function Feed({ account }: FeedProps) {
  const [posts, setPosts] = useState<any[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);

  const loadPosts = useCallback(async (reset = false) => {
    setLoading(true);
    const newOffset = reset ? 0 : offset;
    const params = new URLSearchParams({
      limit: "20",
      offset: String(newOffset),
    });
    if (account) params.set("account", account);

    const res = await fetch(`/api/feed?${params}`);
    const data = await res.json();

    if (reset) {
      setPosts(data.posts);
    } else {
      setPosts((prev) => [...prev, ...data.posts]);
    }
    setOffset(newOffset + data.posts.length);
    setHasMore(data.hasMore);
    setLoading(false);
  }, [offset, account]);

  useEffect(() => {
    loadPosts(true);
  }, [account]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {posts.map((post) => (
          <PostCard key={post.id} post={post} />
        ))}
      </div>
      {posts.length === 0 && !loading && (
        <p className="text-center text-muted-foreground py-12">No posts yet.</p>
      )}
      {hasMore && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => loadPosts()} disabled={loading}>
            {loading ? "Loading..." : "Load more"}
          </Button>
        </div>
      )}
    </div>
  );
}
```

**Step 3: Write main timeline page and layout**

```tsx
// web/src/app/layout.tsx
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Link from "next/link";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "ig-sub",
  description: "Instagram digest feed",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <header className="border-b">
          <nav className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
            <Link href="/" className="font-semibold text-lg">ig-sub</Link>
            <Link href="/settings" className="text-sm text-muted-foreground hover:text-foreground">
              Settings
            </Link>
          </nav>
        </header>
        <main className="max-w-5xl mx-auto px-4 py-6">
          {children}
        </main>
      </body>
    </html>
  );
}
```

```tsx
// web/src/app/page.tsx
import { Feed } from "@/components/feed";
import { getAccounts } from "@/lib/db";
import Link from "next/link";

export default function HomePage() {
  let accounts: any[] = [];
  try {
    accounts = getAccounts();
  } catch {
    // DB may not exist yet
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Feed</h1>
        {accounts.length > 0 && (
          <div className="flex gap-2 flex-wrap">
            {accounts.map((a) => (
              <Link
                key={a.username}
                href={`/account/${a.username}`}
                className="text-sm px-3 py-1 rounded-full border hover:bg-accent"
              >
                @{a.username}
              </Link>
            ))}
          </div>
        )}
      </div>
      <Feed />
    </div>
  );
}
```

**Step 4: Commit**

```bash
git add web/src/
git commit -m "feat: feed API routes, post cards, and timeline page with account filtering"
```

---

### Task 13: Post & Story Detail Pages

**Files:**
- Create: `web/src/app/post/[id]/page.tsx`
- Create: `web/src/app/story/[id]/page.tsx`
- Create: `web/src/app/account/[username]/page.tsx`

**Step 1: Write post detail page**

```tsx
// web/src/app/post/[id]/page.tsx
import { getPost, getMediaForPost } from "@/lib/db";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { notFound } from "next/navigation";

export default async function PostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const post = getPost(id);
  if (!post) notFound();

  const media = getMediaForPost(id);

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-4">
        <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">&larr; Back to feed</Link>
      </div>

      <div className="flex items-center gap-2 mb-4">
        <Link href={`/account/${post.username}`} className="font-semibold hover:underline">
          @{post.username}
        </Link>
        <Badge variant="secondary">{post.type}</Badge>
        <span className="text-sm text-muted-foreground">
          {new Date(post.timestamp).toLocaleString()}
        </span>
      </div>

      <div className="space-y-4">
        {media.map((m) => (
          <div key={m.id}>
            {m.media_type === "image" ? (
              <img src={`/api/media/${m.file_path}`} alt="" className="w-full rounded-lg" />
            ) : (
              <video src={`/api/media/${m.file_path}`} controls className="w-full rounded-lg" />
            )}
          </div>
        ))}
      </div>

      {post.caption && (
        <p className="mt-4 text-sm whitespace-pre-wrap">{post.caption}</p>
      )}

      {post.permalink && (
        <a
          href={post.permalink}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block mt-4 text-sm text-muted-foreground hover:text-foreground"
        >
          View on Instagram &rarr;
        </a>
      )}
    </div>
  );
}
```

**Step 2: Write story detail page**

```tsx
// web/src/app/story/[id]/page.tsx
import { getPost, getMediaForPost } from "@/lib/db";
import Link from "next/link";
import { notFound } from "next/navigation";

export default async function StoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const story = getPost(id);
  if (!story) notFound();

  const media = getMediaForPost(id);

  return (
    <div className="max-w-lg mx-auto">
      <div className="mb-4">
        <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">&larr; Back to feed</Link>
      </div>

      <div className="flex items-center gap-2 mb-4">
        <Link href={`/account/${story.username}`} className="font-semibold hover:underline">
          @{story.username}
        </Link>
        <span className="text-sm text-muted-foreground">
          {new Date(story.timestamp).toLocaleString()}
        </span>
      </div>

      {media.map((m) => (
        <div key={m.id} className="mb-4">
          {m.media_type === "image" ? (
            <img src={`/api/media/${m.file_path}`} alt="" className="w-full rounded-lg" />
          ) : (
            <video src={`/api/media/${m.file_path}`} controls autoPlay muted className="w-full rounded-lg" />
          )}
        </div>
      ))}
    </div>
  );
}
```

**Step 3: Write account page**

```tsx
// web/src/app/account/[username]/page.tsx
import { Feed } from "@/components/feed";
import Link from "next/link";

export default async function AccountPage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;

  return (
    <div>
      <div className="mb-4">
        <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">&larr; Back to feed</Link>
      </div>
      <h1 className="text-2xl font-bold mb-6">@{username}</h1>
      <Feed account={username} />
    </div>
  );
}
```

**Step 4: Commit**

```bash
git add web/src/app/post/ web/src/app/story/ web/src/app/account/
git commit -m "feat: post, story, and account detail pages"
```

---

### Task 14: Settings Page & Cookie Management UI

**Files:**
- Create: `web/src/app/settings/page.tsx`
- Create: `web/src/app/api/settings/route.ts`
- Create: `web/src/components/settings-form.tsx`

**Step 1: Write settings API route**

```typescript
// web/src/app/api/settings/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getConfig, setConfig } from "@/lib/db";

export async function GET() {
  const cookieStatus = getConfig("ig_cookies_stale");
  const hasCookies = getConfig("ig_cookies") !== null;
  const cronSchedule = getConfig("cron_schedule") || "0 8 * * *";
  const emailRecipient = getConfig("email_recipient") || process.env.EMAIL_RECIPIENT || "";

  return NextResponse.json({
    hasCookies,
    cookiesStale: cookieStatus === "true",
    cronSchedule,
    emailRecipient,
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json();

  if (body.cookies) {
    // Encrypt and store cookies - delegate to the scraper's encryption
    // For now, store via the shared config table
    // The web app needs the encryption key to store cookies
    const { createCipheriv, randomBytes, createHash } = await import("crypto");

    const encryptionKey = process.env.ENCRYPTION_KEY || "";
    if (!encryptionKey) {
      return NextResponse.json({ error: "Encryption key not configured" }, { status: 500 });
    }

    // Use same encryption as Python side (Fernet-compatible)
    // Actually, we'll use a simpler shared approach: store the cookies
    // encrypted with the same Fernet key derivation
    const { Fernet } = await import("@/lib/fernet");
    const fernet = new Fernet(encryptionKey);
    const encrypted = fernet.encrypt(JSON.stringify(body.cookies));
    setConfig("ig_cookies", encrypted);
    setConfig("ig_cookies_stale", "false");
  }

  if (body.cronSchedule) {
    setConfig("cron_schedule", body.cronSchedule);
  }

  if (body.emailRecipient !== undefined) {
    setConfig("email_recipient", body.emailRecipient);
  }

  return NextResponse.json({ ok: true });
}
```

**Step 2: Write Fernet-compatible encryption for TypeScript**

```typescript
// web/src/lib/fernet.ts
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

/**
 * Minimal Fernet-compatible encryption matching the Python side.
 * Uses the same key derivation: SHA-256 of the hex key bytes.
 */
export class Fernet {
  private key: Buffer;

  constructor(hexKey: string) {
    const keyBytes = Buffer.from(hexKey, "hex");
    this.key = createHash("sha256").update(keyBytes).digest();
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(16);
    const cipher = createCipheriv("aes-256-cbc", this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    // Store as: base64(iv + encrypted)
    return Buffer.concat([iv, encrypted]).toString("base64");
  }

  decrypt(token: string): string {
    const data = Buffer.from(token, "base64");
    const iv = data.subarray(0, 16);
    const encrypted = data.subarray(16);
    const decipher = createDecipheriv("aes-256-cbc", this.key, iv);
    return decipher.update(encrypted) + decipher.final("utf8");
  }
}
```

Note: Since we're introducing a custom shared encryption format, the Python `cookies.py` in Task 3 must be updated to use the same AES-256-CBC approach instead of Fernet. Update `scraper/src/cookies.py`:

```python
# Updated scraper/src/cookies.py
import json
import os
from base64 import b64encode, b64decode
from hashlib import sha256
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives import padding
from src.db import Database


class CookieManager:
    def __init__(self, db: Database, encryption_key: str):
        self.db = db
        key_bytes = bytes.fromhex(encryption_key)
        self._key = sha256(key_bytes).digest()  # 32 bytes for AES-256

    def _encrypt(self, plaintext: str) -> str:
        iv = os.urandom(16)
        padder = padding.PKCS7(128).padder()
        padded = padder.update(plaintext.encode()) + padder.finalize()
        cipher = Cipher(algorithms.AES(self._key), modes.CBC(iv))
        encryptor = cipher.encryptor()
        encrypted = encryptor.update(padded) + encryptor.finalize()
        return b64encode(iv + encrypted).decode()

    def _decrypt(self, token: str) -> str:
        data = b64decode(token)
        iv = data[:16]
        encrypted = data[16:]
        cipher = Cipher(algorithms.AES(self._key), modes.CBC(iv))
        decryptor = cipher.decryptor()
        padded = decryptor.update(encrypted) + decryptor.finalize()
        unpadder = padding.PKCS7(128).unpadder()
        return (unpadder.update(padded) + unpadder.finalize()).decode()

    def store_cookies(self, cookies: dict[str, str]):
        encrypted = self._encrypt(json.dumps(cookies))
        self.db.set_config("ig_cookies", encrypted)
        self.db.set_config("ig_cookies_stale", "false")

    def get_cookies(self) -> dict[str, str] | None:
        encrypted = self.db.get_config("ig_cookies")
        if not encrypted:
            return None
        plaintext = self._decrypt(encrypted)
        return json.loads(plaintext)

    def mark_stale(self):
        self.db.set_config("ig_cookies_stale", "true")

    def is_stale(self) -> bool:
        return self.db.get_config("ig_cookies_stale") == "true"
```

**Step 3: Write settings page component**

```tsx
// web/src/components/settings-form.tsx
"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export function SettingsForm() {
  const [settings, setSettings] = useState<any>(null);
  const [sessionid, setSessionid] = useState("");
  const [csrftoken, setCsrftoken] = useState("");
  const [dsUserId, setDsUserId] = useState("");
  const [cronSchedule, setCronSchedule] = useState("");
  const [emailRecipient, setEmailRecipient] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => {
        setSettings(data);
        setCronSchedule(data.cronSchedule);
        setEmailRecipient(data.emailRecipient);
      });
  }, []);

  async function saveCookies() {
    setSaving(true);
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cookies: { sessionid, csrftoken, ds_user_id: dsUserId },
      }),
    });
    setMessage("Cookies saved.");
    setSaving(false);
    setSessionid("");
    setCsrftoken("");
    setDsUserId("");
    // Refresh status
    const data = await fetch("/api/settings").then((r) => r.json());
    setSettings(data);
  }

  async function saveConfig() {
    setSaving(true);
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cronSchedule, emailRecipient }),
    });
    setMessage("Settings saved.");
    setSaving(false);
  }

  if (!settings) return <p>Loading...</p>;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Instagram Cookies
            {settings.hasCookies && !settings.cookiesStale && (
              <Badge className="bg-green-100 text-green-800">Active</Badge>
            )}
            {settings.cookiesStale && (
              <Badge variant="destructive">Stale - update required</Badge>
            )}
            {!settings.hasCookies && (
              <Badge variant="secondary">Not configured</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="sessionid">sessionid</Label>
            <Input id="sessionid" value={sessionid} onChange={(e) => setSessionid(e.target.value)} placeholder="Paste sessionid cookie" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="csrftoken">csrftoken</Label>
            <Input id="csrftoken" value={csrftoken} onChange={(e) => setCsrftoken(e.target.value)} placeholder="Paste csrftoken cookie" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ds_user_id">ds_user_id</Label>
            <Input id="ds_user_id" value={dsUserId} onChange={(e) => setDsUserId(e.target.value)} placeholder="Paste ds_user_id cookie" />
          </div>
          <Button onClick={saveCookies} disabled={saving || !sessionid}>
            {saving ? "Saving..." : "Save Cookies"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Schedule & Email</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="cron">Cron Schedule</Label>
            <Input id="cron" value={cronSchedule} onChange={(e) => setCronSchedule(e.target.value)} placeholder="0 8 * * *" />
            <p className="text-xs text-muted-foreground">Standard cron expression (minute hour day month weekday)</p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="email">Email Recipient</Label>
            <Input id="email" type="email" value={emailRecipient} onChange={(e) => setEmailRecipient(e.target.value)} placeholder="you@example.com" />
          </div>
          <Button onClick={saveConfig} disabled={saving}>
            {saving ? "Saving..." : "Save Settings"}
          </Button>
        </CardContent>
      </Card>

      {message && <p className="text-sm text-green-600">{message}</p>}
    </div>
  );
}
```

```tsx
// web/src/app/settings/page.tsx
import { SettingsForm } from "@/components/settings-form";

export default function SettingsPage() {
  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Settings</h1>
      <SettingsForm />
    </div>
  );
}
```

**Step 4: Commit**

```bash
git add web/src/
git commit -m "feat: settings page with cookie management, cron schedule, and email config"
```

---

### Task 15: Integration Testing & Polish

**Step 1: Create data directories**

```bash
mkdir -p data/db data/media data/caddy
```

**Step 2: Create `.env` from example**

```bash
cp .env.example .env
# Edit with real values
```

**Step 3: Test scraper locally**

```bash
cd scraper
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -c "from src.db import Database; db = Database('/tmp/test.db'); db.initialize(); print('DB OK')"
python -m pytest tests/ -v
```

**Step 4: Test web locally**

```bash
cd web
npm install
npm run dev
# Visit http://localhost:3000 - should redirect to /login
```

**Step 5: Test Docker Compose**

```bash
docker compose build
docker compose up -d
# Check logs
docker compose logs -f
```

**Step 6: Commit**

```bash
git add -A
git commit -m "feat: integration polish, data directories, and final wiring"
```

---

## Task Summary

| # | Task | Description |
|---|---|---|
| 1 | Project Scaffold | docker-compose.yml, Dockerfiles, Caddyfile, .env |
| 2 | SQLite DB Layer | Python database module with all CRUD operations |
| 3 | Cookie Encryption | AES-256-CBC encryption, staleness tracking |
| 4 | Instagram Client | instagrapi wrapper for posts, stories, validation |
| 5 | Media Downloader | Download with thumbnails, deduplication |
| 6 | Email Digest | Jinja2 template, Resend integration |
| 7 | Scrape Logic | Core loop: fetch, download, store, digest |
| 8 | Scheduler | APScheduler main loop with cron config |
| 9 | Next.js Setup | Scaffold, shadcn, better-sqlite3 |
| 10 | Web DB & Auth | TypeScript DB helpers, session auth |
| 11 | Login & Middleware | Password auth, session cookies |
| 12 | Feed & Timeline | API routes, post cards, main page |
| 13 | Detail Pages | Post, story, account views |
| 14 | Settings Page | Cookie input, cron config, shared encryption |
| 15 | Integration | Local testing, Docker build, polish |
