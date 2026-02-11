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
  // Invalidate cached read-only connection so next getConfig sees the write
  if (_db) {
    _db.close();
    _db = null;
  }
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

export interface ScrapeRun {
  id: number;
  started_at: string;
  finished_at: string | null;
  status: string | null;
  new_posts_count: number;
  new_stories_count: number;
  error: string | null;
  log: string;
}

export function getRecentScrapeRuns(limit = 20): ScrapeRun[] {
  return getDb()
    .prepare("SELECT * FROM scrape_runs ORDER BY started_at DESC LIMIT ?")
    .all(limit) as ScrapeRun[];
}

export function getScrapeRunLog(runId: number): string {
  const row = getDb().prepare("SELECT log FROM scrape_runs WHERE id = ?").get(runId) as { log: string } | undefined;
  return row?.log ?? "";
}

// ── Facebook Groups ────────────────────────────────────────────

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
