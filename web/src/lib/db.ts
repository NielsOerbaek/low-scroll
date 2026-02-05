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

export function getFeed(limit = 20, offset = 0, account?: string, type?: string): Post[] {
  const db = getDb();
  const conditions: string[] = [];
  const params: any[] = [];

  if (account) {
    conditions.push("username = ?");
    params.push(account);
  }
  if (type === "story") {
    conditions.push("type = 'story'");
  } else if (type === "post") {
    conditions.push("type IN ('post', 'reel')");
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(limit, offset);
  return db
    .prepare(`SELECT * FROM posts ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`)
    .all(...params) as Post[];
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
  log: string;
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

export function getManualRunLog(runId: number): string {
  const row = getDb().prepare("SELECT log FROM manual_runs WHERE id = ?").get(runId) as { log: string } | undefined;
  return row?.log ?? "";
}
