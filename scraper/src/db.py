import sqlite3


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
                id TEXT NOT NULL,
                user_id INTEGER NOT NULL REFERENCES users(id),
                username TEXT NOT NULL,
                type TEXT NOT NULL CHECK(type IN ('post','reel','story')),
                caption TEXT,
                timestamp DATETIME,
                permalink TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (user_id, id)
            );

            CREATE TABLE IF NOT EXISTS media (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                post_id TEXT NOT NULL,
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

            CREATE TABLE IF NOT EXISTS newsletter_emails (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id),
                message_id TEXT,
                from_address TEXT NOT NULL,
                to_address TEXT NOT NULL,
                subject TEXT,
                body_text TEXT,
                body_html TEXT,
                received_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                processed INTEGER DEFAULT 0,
                is_confirmation INTEGER DEFAULT 0,
                confirmation_clicked INTEGER DEFAULT 0,
                digest_date TEXT
            );

            CREATE TABLE IF NOT EXISTS newsletter_digest_runs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id),
                digest_date TEXT NOT NULL,
                email_count INTEGER DEFAULT 0,
                started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                finished_at DATETIME,
                status TEXT DEFAULT 'pending',
                error TEXT
            );
        """)

    # ── Users ──────────────────────────────────────────────────────

    def insert_user(self, email: str, password_hash: str) -> int:
        cursor = self.execute(
            "INSERT INTO users (email, password_hash) VALUES (?, ?)",
            (email, password_hash),
        )
        self.conn.commit()
        return cursor.lastrowid

    def get_user_by_email(self, email: str) -> dict | None:
        row = self.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
        return dict(row) if row else None

    def get_user_by_id(self, user_id: int) -> dict | None:
        row = self.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
        return dict(row) if row else None

    def get_all_active_users(self) -> list[dict]:
        rows = self.execute(
            """SELECT u.* FROM users u
               JOIN user_config uc ON u.id = uc.user_id AND uc.key = 'ig_cookies'
               WHERE u.is_active = 1"""
        ).fetchall()
        return [dict(r) for r in rows]

    def deactivate_user(self, user_id: int):
        self.execute("UPDATE users SET is_active=0 WHERE id=?", (user_id,))
        self.conn.commit()

    # ── Sessions ───────────────────────────────────────────────────

    def insert_session(self, token: str, user_id: int, expires_at: str):
        self.execute(
            "INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)",
            (token, user_id, expires_at),
        )
        self.conn.commit()

    def get_session(self, token: str) -> dict | None:
        row = self.execute(
            "SELECT * FROM sessions WHERE token=? AND expires_at > datetime('now')",
            (token,),
        ).fetchone()
        return dict(row) if row else None

    def delete_session(self, token: str):
        self.execute("DELETE FROM sessions WHERE token=?", (token,))
        self.conn.commit()

    def delete_expired_sessions(self):
        self.execute("DELETE FROM sessions WHERE expires_at <= datetime('now')")
        self.conn.commit()

    # ── User Config ────────────────────────────────────────────────

    def set_user_config(self, user_id: int, key: str, value: str):
        self.execute(
            """INSERT INTO user_config (user_id, key, value) VALUES (?, ?, ?)
               ON CONFLICT(user_id, key) DO UPDATE SET value=excluded.value""",
            (user_id, key, value),
        )
        self.conn.commit()

    def get_user_config(self, user_id: int, key: str) -> str | None:
        row = self.execute(
            "SELECT value FROM user_config WHERE user_id=? AND key=?",
            (user_id, key),
        ).fetchone()
        return row["value"] if row else None

    # ── Instagram Accounts ─────────────────────────────────────────

    def upsert_account(self, user_id: int, username: str, profile_pic_path: str | None):
        self.execute(
            """INSERT INTO accounts (user_id, username, profile_pic_path)
               VALUES (?, ?, ?)
               ON CONFLICT(user_id, username) DO UPDATE SET profile_pic_path=excluded.profile_pic_path""",
            (user_id, username, profile_pic_path),
        )
        self.conn.commit()

    def delete_accounts_not_in(self, user_id: int, usernames: list[str]):
        if not usernames:
            return
        placeholders = ",".join("?" for _ in usernames)
        self.execute(
            f"""DELETE FROM accounts WHERE user_id=? AND username NOT IN ({placeholders})
                AND username NOT IN (SELECT DISTINCT username FROM posts WHERE user_id=?)""",
            [user_id] + usernames + [user_id],
        )
        self.conn.commit()

    def get_account(self, user_id: int, username: str) -> dict | None:
        row = self.execute(
            "SELECT * FROM accounts WHERE user_id=? AND username=?",
            (user_id, username),
        ).fetchone()
        return dict(row) if row else None

    def get_all_accounts(self, user_id: int) -> list[dict]:
        rows = self.execute(
            "SELECT * FROM accounts WHERE user_id=? ORDER BY username",
            (user_id,),
        ).fetchall()
        return [dict(r) for r in rows]

    def update_last_checked(self, user_id: int, username: str):
        self.execute(
            "UPDATE accounts SET last_checked_at=datetime('now') WHERE user_id=? AND username=?",
            (user_id, username),
        )
        self.conn.commit()

    # ── Instagram Posts ────────────────────────────────────────────

    def insert_post(self, user_id: int, id: str, username: str, post_type: str,
                    caption: str, timestamp: str, permalink: str) -> bool:
        try:
            self.execute(
                """INSERT INTO posts (id, user_id, username, type, caption, timestamp, permalink)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (id, user_id, username, post_type, caption, timestamp, permalink),
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

    def get_feed(self, user_id: int, limit: int = 20, offset: int = 0,
                 account: str | None = None) -> list[dict]:
        if account:
            rows = self.execute(
                "SELECT * FROM posts WHERE user_id=? AND username=? ORDER BY timestamp DESC LIMIT ? OFFSET ?",
                (user_id, account, limit, offset),
            ).fetchall()
        else:
            rows = self.execute(
                "SELECT * FROM posts WHERE user_id=? ORDER BY timestamp DESC LIMIT ? OFFSET ?",
                (user_id, limit, offset),
            ).fetchall()
        return [dict(r) for r in rows]

    def get_new_posts_since(self, user_id: int, since: str) -> list[dict]:
        rows = self.execute(
            "SELECT * FROM posts WHERE user_id=? AND created_at > ? ORDER BY timestamp DESC",
            (user_id, since),
        ).fetchall()
        return [dict(r) for r in rows]

    # ── Scrape Runs ────────────────────────────────────────────────

    def insert_scrape_run(self, user_id: int) -> int:
        cursor = self.execute(
            "INSERT INTO scrape_runs (user_id) VALUES (?)", (user_id,)
        )
        self.conn.commit()
        return cursor.lastrowid

    def finish_scrape_run(self, run_id: int, status: str,
                          new_posts: int = 0, new_stories: int = 0,
                          error: str | None = None):
        self.execute(
            """UPDATE scrape_runs
               SET finished_at=datetime('now'), status=?, new_posts_count=?, new_stories_count=?,
                   error=?
               WHERE id=?""",
            (status, new_posts, new_stories, error, run_id),
        )
        self.conn.commit()

    def get_scrape_run(self, run_id: int) -> dict | None:
        row = self.execute("SELECT * FROM scrape_runs WHERE id=?", (run_id,)).fetchone()
        return dict(row) if row else None

    def append_scrape_run_log(self, run_id: int, line: str):
        self.execute(
            "UPDATE scrape_runs SET log = log || ? WHERE id=?",
            (line + "\n", run_id),
        )
        self.conn.commit()

    def get_recent_scrape_runs(self, user_id: int, limit: int = 20) -> list[dict]:
        rows = self.execute(
            "SELECT * FROM scrape_runs WHERE user_id=? ORDER BY started_at DESC LIMIT ?",
            (user_id, limit),
        ).fetchall()
        return [dict(r) for r in rows]

    def get_last_scrape_time(self, user_id: int) -> str | None:
        row = self.execute(
            """SELECT finished_at FROM scrape_runs
               WHERE user_id=? AND status='success' AND finished_at IS NOT NULL
               ORDER BY finished_at DESC LIMIT 1""",
            (user_id,),
        ).fetchone()
        return row["finished_at"] if row else None

    # ── Manual Runs ────────────────────────────────────────────────

    def insert_manual_run(self, user_id: int, since_date: str) -> int:
        cursor = self.execute(
            "INSERT INTO manual_runs (user_id, since_date) VALUES (?, ?)",
            (user_id, since_date),
        )
        self.conn.commit()
        return cursor.lastrowid

    def get_pending_manual_run(self, user_id: int) -> dict | None:
        row = self.execute(
            "SELECT * FROM manual_runs WHERE user_id=? AND status='pending' ORDER BY created_at ASC LIMIT 1",
            (user_id,),
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

    def get_recent_manual_runs(self, user_id: int, limit: int = 10) -> list[dict]:
        rows = self.execute(
            "SELECT * FROM manual_runs WHERE user_id=? ORDER BY created_at DESC LIMIT ?",
            (user_id, limit),
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

    # ── Facebook Groups ────────────────────────────────────────────

    def upsert_fb_group(self, user_id: int, group_id: str, name: str, url: str):
        self.execute(
            """INSERT INTO fb_groups (user_id, group_id, name, url)
               VALUES (?, ?, ?, ?)
               ON CONFLICT(user_id, group_id) DO UPDATE SET name=excluded.name, url=excluded.url""",
            (user_id, group_id, name, url),
        )
        self.conn.commit()

    def get_fb_group(self, user_id: int, group_id: str) -> dict | None:
        row = self.execute(
            "SELECT * FROM fb_groups WHERE user_id=? AND group_id=?",
            (user_id, group_id),
        ).fetchone()
        return dict(row) if row else None

    def get_all_fb_groups(self, user_id: int) -> list[dict]:
        rows = self.execute(
            "SELECT * FROM fb_groups WHERE user_id=? ORDER BY name",
            (user_id,),
        ).fetchall()
        return [dict(r) for r in rows]

    def delete_fb_group(self, user_id: int, group_id: str):
        if not self.get_fb_group(user_id, group_id):
            return
        self.execute(
            "DELETE FROM fb_groups WHERE user_id=? AND group_id=?",
            (user_id, group_id),
        )
        # Only delete posts/comments if no other user references this group
        other = self.execute(
            "SELECT 1 FROM fb_groups WHERE group_id=? LIMIT 1", (group_id,)
        ).fetchone()
        if not other:
            self.execute(
                "DELETE FROM fb_comments WHERE post_id IN (SELECT id FROM fb_posts WHERE group_id=?)",
                (group_id,),
            )
            self.execute("DELETE FROM fb_posts WHERE group_id=?", (group_id,))
        self.conn.commit()

    def update_fb_group_last_checked(self, user_id: int, group_id: str):
        self.execute(
            "UPDATE fb_groups SET last_checked_at=datetime('now') WHERE user_id=? AND group_id=?",
            (user_id, group_id),
        )
        self.conn.commit()

    # ── Facebook Posts & Comments ──────────────────────────────────

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

    def get_new_fb_posts_since(self, user_id: int, since: str) -> list[dict]:
        rows = self.execute(
            """SELECT fp.* FROM fb_posts fp
               JOIN fb_groups fg ON fp.group_id = fg.group_id
               WHERE fg.user_id=? AND fp.created_at > ?
               ORDER BY fp.timestamp DESC""",
            (user_id, since),
        ).fetchall()
        return [dict(r) for r in rows]

    # ── Unified Feed ───────────────────────────────────────────────

    def get_unified_feed(self, user_id: int, limit: int = 20, offset: int = 0,
                         account: str | None = None, group_id: str | None = None,
                         type: str | None = None, platform: str | None = None) -> list[dict]:
        parts = []
        params = []

        if platform != "facebook":
            ig_where = ["user_id = ?"]
            params.append(user_id)
            if account:
                ig_where.append("username = ?")
                params.append(account)
            if type:
                ig_where.append("type = ?")
                params.append(type)
            ig_clause = " WHERE " + " AND ".join(ig_where)
            parts.append(
                f"""SELECT id, username AS source_name, type, caption AS content,
                       timestamp, permalink, 'instagram' AS platform,
                       NULL AS comment_count
                FROM posts{ig_clause}"""
            )

        if platform != "instagram":
            fb_where = ["fg.user_id = ?"]
            params.append(user_id)
            if group_id:
                fb_where.append("fp.group_id = ?")
                params.append(group_id)
            if type:
                fb_where.append("'fb_post' = ?")
                params.append(type)
            fb_clause = " WHERE " + " AND ".join(fb_where)
            parts.append(
                f"""SELECT fp.id, fg.name AS source_name, 'fb_post' AS type,
                       fp.content, fp.timestamp, fp.permalink,
                       'facebook' AS platform, fp.comment_count
                FROM fb_posts fp JOIN fb_groups fg ON fp.group_id = fg.group_id{fb_clause}"""
            )

        if not parts:
            return []

        sql = " UNION ALL ".join(parts) + " ORDER BY timestamp DESC LIMIT ? OFFSET ?"
        params.extend([limit, offset])
        rows = self.execute(sql, params).fetchall()
        return [dict(r) for r in rows]

    # ── Newsletter ─────────────────────────────────────────────────

    def insert_newsletter_email(self, user_id: int, message_id: str,
                                from_address: str, to_address: str,
                                subject: str, body_text: str,
                                body_html: str) -> int:
        cursor = self.execute(
            """INSERT INTO newsletter_emails
               (user_id, message_id, from_address, to_address, subject, body_text, body_html)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (user_id, message_id, from_address, to_address, subject, body_text, body_html),
        )
        self.conn.commit()
        return cursor.lastrowid

    def get_unclassified_emails(self, user_id: int) -> list[dict]:
        rows = self.execute(
            """SELECT * FROM newsletter_emails
               WHERE user_id=? AND processed=0
               ORDER BY received_at ASC""",
            (user_id,),
        ).fetchall()
        return [dict(r) for r in rows]

    def get_unprocessed_confirmations(self, user_id: int) -> list[dict]:
        rows = self.execute(
            """SELECT * FROM newsletter_emails
               WHERE user_id=? AND is_confirmation=1 AND confirmation_clicked=0
               ORDER BY received_at ASC""",
            (user_id,),
        ).fetchall()
        return [dict(r) for r in rows]

    def mark_email_as_confirmation(self, email_id: int):
        self.execute(
            "UPDATE newsletter_emails SET is_confirmation=1, processed=1 WHERE id=?",
            (email_id,),
        )
        self.conn.commit()

    def mark_email_processed(self, email_id: int):
        self.execute(
            "UPDATE newsletter_emails SET processed=1 WHERE id=?",
            (email_id,),
        )
        self.conn.commit()

    def mark_confirmation_clicked(self, email_id: int):
        self.execute(
            "UPDATE newsletter_emails SET confirmation_clicked=1 WHERE id=?",
            (email_id,),
        )
        self.conn.commit()

    def get_undigested_emails(self, user_id: int) -> list[dict]:
        rows = self.execute(
            """SELECT * FROM newsletter_emails
               WHERE user_id=? AND processed=1 AND is_confirmation=0 AND digest_date IS NULL
               ORDER BY received_at ASC""",
            (user_id,),
        ).fetchall()
        return [dict(r) for r in rows]

    def mark_emails_digested(self, email_ids: list[int], digest_date: str):
        if not email_ids:
            return
        placeholders = ",".join("?" for _ in email_ids)
        self.execute(
            f"UPDATE newsletter_emails SET digest_date=? WHERE id IN ({placeholders})",
            [digest_date] + email_ids,
        )
        self.conn.commit()

    def insert_newsletter_digest_run(self, user_id: int, digest_date: str) -> int:
        cursor = self.execute(
            "INSERT INTO newsletter_digest_runs (user_id, digest_date) VALUES (?, ?)",
            (user_id, digest_date),
        )
        self.conn.commit()
        return cursor.lastrowid

    def finish_newsletter_digest_run(self, run_id: int, status: str,
                                     email_count: int = 0,
                                     error: str | None = None):
        self.execute(
            """UPDATE newsletter_digest_runs
               SET finished_at=datetime('now'), status=?, email_count=?, error=?
               WHERE id=?""",
            (status, email_count, error, run_id),
        )
        self.conn.commit()

    def save_email_summary(self, email_id: int, summary: str):
        try:
            self.execute("ALTER TABLE newsletter_emails ADD COLUMN summary TEXT")
        except Exception:
            pass
        self.execute(
            "UPDATE newsletter_emails SET summary=? WHERE id=?",
            (summary, email_id),
        )
        self.conn.commit()

    def save_digest_html(self, run_id: int, html: str):
        # Ensure column exists (idempotent migration)
        try:
            self.execute("ALTER TABLE newsletter_digest_runs ADD COLUMN digest_html TEXT")
        except Exception:
            pass  # Column already exists
        self.execute(
            "UPDATE newsletter_digest_runs SET digest_html=? WHERE id=?",
            (html, run_id),
        )
        self.conn.commit()

    def get_digest_runs(self, user_id: int, limit: int = 20) -> list[dict]:
        rows = self.execute(
            """SELECT id, user_id, digest_date, email_count, started_at, finished_at,
                      status, error, digest_html
               FROM newsletter_digest_runs
               WHERE user_id=?
               ORDER BY started_at DESC LIMIT ?""",
            (user_id, limit),
        ).fetchall()
        return [dict(r) for r in rows]

    def get_last_newsletter_digest_date(self, user_id: int) -> str | None:
        row = self.execute(
            """SELECT digest_date FROM newsletter_digest_runs
               WHERE user_id=? AND status='success'
               ORDER BY digest_date DESC LIMIT 1""",
            (user_id,),
        ).fetchone()
        return row["digest_date"] if row else None

    def close(self):
        if self._conn:
            self._conn.close()
            self._conn = None
