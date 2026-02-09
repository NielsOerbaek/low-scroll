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

            CREATE TABLE IF NOT EXISTS manual_runs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                since_date TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                new_posts_count INTEGER DEFAULT 0,
                new_stories_count INTEGER DEFAULT 0,
                error TEXT,
                log TEXT DEFAULT '',
                created_at DATETIME DEFAULT (datetime('now')),
                started_at DATETIME,
                finished_at DATETIME
            );
        """)
        # Migration: add log column if missing (existing DBs)
        cols = {row[1] for row in self.conn.execute("PRAGMA table_info(manual_runs)").fetchall()}
        if "log" not in cols:
            self.conn.execute("ALTER TABLE manual_runs ADD COLUMN log TEXT DEFAULT ''")

    def upsert_account(self, username: str, profile_pic_path: str | None):
        self.execute(
            """INSERT INTO accounts (username, profile_pic_path)
               VALUES (?, ?)
               ON CONFLICT(username) DO UPDATE SET profile_pic_path=excluded.profile_pic_path""",
            (username, profile_pic_path),
        )
        self.conn.commit()

    def delete_accounts_not_in(self, usernames: list[str]):
        if not usernames:
            return
        placeholders = ",".join("?" for _ in usernames)
        self.execute(
            f"DELETE FROM accounts WHERE username NOT IN ({placeholders})",
            usernames,
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
            return False

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

    def insert_manual_run(self, since_date: str) -> int:
        cursor = self.execute(
            "INSERT INTO manual_runs (since_date) VALUES (?)", (since_date,)
        )
        self.conn.commit()
        return cursor.lastrowid

    def get_pending_manual_run(self) -> dict | None:
        row = self.execute(
            "SELECT * FROM manual_runs WHERE status='pending' ORDER BY created_at ASC LIMIT 1"
        ).fetchone()
        return dict(row) if row else None

    def start_manual_run(self, run_id: int):
        self.execute(
            "UPDATE manual_runs SET status='running', started_at=datetime('now') WHERE id=?",
            (run_id,),
        )
        self.conn.commit()

    def finish_manual_run(self, run_id: int, status: str,
                          new_posts: int = 0, new_stories: int = 0,
                          error: str | None = None):
        self.execute(
            """UPDATE manual_runs
               SET status=?, finished_at=datetime('now'),
                   new_posts_count=?, new_stories_count=?, error=?
               WHERE id=?""",
            (status, new_posts, new_stories, error, run_id),
        )
        self.conn.commit()

    def append_manual_run_log(self, run_id: int, line: str):
        self.execute(
            "UPDATE manual_runs SET log = log || ? WHERE id=?",
            (line + "\n", run_id),
        )
        self.conn.commit()

    def get_manual_run_log(self, run_id: int) -> str:
        row = self.execute("SELECT log FROM manual_runs WHERE id=?", (run_id,)).fetchone()
        return row["log"] if row else ""

    def get_recent_manual_runs(self, limit: int = 10) -> list[dict]:
        rows = self.execute(
            "SELECT * FROM manual_runs ORDER BY created_at DESC LIMIT ?", (limit,)
        ).fetchall()
        return [dict(r) for r in rows]

    def reset_stale_manual_runs(self):
        self.execute(
            """UPDATE manual_runs SET status='error', error='Stale: reset on startup',
               finished_at=datetime('now')
               WHERE status='running'
               AND started_at < datetime('now', '-1 hour')"""
        )
        self.conn.commit()

    def close(self):
        if self._conn:
            self._conn.close()
            self._conn = None
