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

export interface ManualRun {
  id: number;
  since_date: string;
  status: string;
  new_posts_count: number;
  new_stories_count: number;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export function insertManualRun(sinceDate: string): number {
  const db = getWritableDb();
  const result = db.prepare("INSERT INTO manual_runs (since_date) VALUES (?)").run(sinceDate);
  db.close();
  return Number(result.lastInsertRowid);
}

export function getRecentManualRuns(limit = 10): ManualRun[] {
  return getDb()
    .prepare("SELECT * FROM manual_runs ORDER BY created_at DESC LIMIT ?")
    .all(limit) as ManualRun[];
}
