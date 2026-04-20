import Database from "better-sqlite3";

const DATABASE_PATH = process.env.DATABASE_PATH || "/data/db/ig.db";

function getDb(): Database.Database {
  const db = new Database(DATABASE_PATH, { readonly: true });
  db.pragma("journal_mode = WAL");
  return db;
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

export function getFeed(userId: number, limit = 20, offset = 0, account?: string, type?: string): Post[] {
  const db = getDb();
  const conditions: string[] = ["user_id = ?"];
  const params: any[] = [userId];

  if (account) {
    conditions.push("username = ?");
    params.push(account);
  }
  if (type === "story") {
    conditions.push("type = 'story'");
  } else if (type === "post") {
    conditions.push("type IN ('post', 'reel')");
  }

  const where = `WHERE ${conditions.join(" AND ")}`;
  params.push(limit, offset);
  return db
    .prepare(`SELECT * FROM posts ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`)
    .all(...params) as Post[];
}

export function getPost(userId: number, id: string): Post | undefined {
  return getDb().prepare("SELECT * FROM posts WHERE user_id = ? AND id = ?").get(userId, id) as Post | undefined;
}

export function getMediaForPost(userId: number, postId: string): Media[] {
  return getDb()
    .prepare('SELECT m.* FROM media m JOIN posts p ON m.post_id = p.id AND p.user_id = ? WHERE m.post_id = ? ORDER BY m."order"')
    .all(userId, postId) as Media[];
}

export function getAccounts(userId: number): Account[] {
  return getDb().prepare("SELECT * FROM accounts WHERE user_id = ? ORDER BY username").all(userId) as Account[];
}

export function getUserConfig(userId: number, key: string): string | null {
  const row = getDb().prepare("SELECT value FROM user_config WHERE user_id = ? AND key = ?").get(userId, key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setUserConfig(userId: number, key: string, value: string): void {
  const db = getWritableDb();
  db.prepare("INSERT INTO user_config (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET value=excluded.value").run(userId, key, value);
  db.close();
}

export function getUserIdByApiKey(apiKey: string): number | null {
  const row = getDb().prepare(
    "SELECT user_id FROM user_config WHERE key = 'api_key' AND value = ?"
  ).get(apiKey) as { user_id: number } | undefined;
  return row?.user_id ?? null;
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

export function insertManualRun(userId: number, sinceDate: string): number {
  const db = getWritableDb();
  const result = db.prepare("INSERT INTO manual_runs (user_id, since_date) VALUES (?, ?)").run(userId, sinceDate);
  db.close();
  return Number(result.lastInsertRowid);
}

export function getRecentManualRuns(userId: number, limit = 10): ManualRun[] {
  return getDb()
    .prepare("SELECT * FROM manual_runs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?")
    .all(userId, limit) as ManualRun[];
}

export function getManualRunLog(userId: number, runId: number): string {
  const row = getDb().prepare("SELECT log FROM manual_runs WHERE id = ? AND user_id = ?").get(runId, userId) as { log: string } | undefined;
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

export function getRecentScrapeRuns(userId: number, limit = 20): ScrapeRun[] {
  return getDb()
    .prepare("SELECT * FROM scrape_runs WHERE user_id = ? ORDER BY started_at DESC LIMIT ?")
    .all(userId, limit) as ScrapeRun[];
}

export function getScrapeRunLog(userId: number, runId: number): string {
  const row = getDb().prepare("SELECT log FROM scrape_runs WHERE id = ? AND user_id = ?").get(runId, userId) as { log: string } | undefined;
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

export function getFbGroups(userId: number): FbGroup[] {
  return getDb().prepare("SELECT * FROM fb_groups WHERE user_id = ? ORDER BY name").all(userId) as FbGroup[];
}

export function addFbGroup(userId: number, groupId: string, name: string, url: string): void {
  const db = getWritableDb();
  db.prepare(
    "INSERT INTO fb_groups (user_id, group_id, name, url) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, group_id) DO UPDATE SET name=excluded.name, url=excluded.url"
  ).run(userId, groupId, name, url);
  db.close();
}

export function deleteFbGroup(userId: number, groupId: string): void {
  const db = getWritableDb();
  db.prepare("DELETE FROM fb_groups WHERE user_id = ? AND group_id=?").run(userId, groupId);
  // Only delete posts/comments if no other user references this group
  const other = db.prepare("SELECT 1 FROM fb_groups WHERE group_id = ? LIMIT 1").get(groupId);
  if (!other) {
    db.prepare("DELETE FROM fb_comments WHERE post_id IN (SELECT id FROM fb_posts WHERE group_id=?)").run(groupId);
    db.prepare("DELETE FROM fb_posts WHERE group_id=?").run(groupId);
  }
  db.close();
}

export function getFbPost(userId: number, postId: string): FbPost | undefined {
  return getDb().prepare(
    "SELECT fp.* FROM fb_posts fp JOIN fb_groups fg ON fp.group_id = fg.group_id AND fg.user_id = ? WHERE fp.id = ?"
  ).get(userId, postId) as FbPost | undefined;
}

export function getCommentsForPost(postId: string): FbComment[] {
  return getDb()
    .prepare('SELECT * FROM fb_comments WHERE post_id = ? ORDER BY "order"')
    .all(postId) as FbComment[];
}

// ── Users & Sessions ──────────────────────────────────────────

export function createUser(email: string, passwordHash: string): number {
  const db = getWritableDb();
  const result = db.prepare(
    "INSERT INTO users (email, password_hash) VALUES (?, ?)"
  ).run(email, passwordHash);
  db.close();
  return Number(result.lastInsertRowid);
}

export function getUserByEmail(email: string): { id: number; email: string; password_hash: string; is_admin: number; is_active: number } | undefined {
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

// ── Admin ─────────────────────────────────────────────────────

export function getAllUsers(): { id: number; email: string; is_admin: number; is_active: number; created_at: string }[] {
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

// ── Newsletter ────────────────────────────────────────────────

export function insertNewsletterEmail(
  userId: number,
  messageId: string,
  fromAddress: string,
  toAddress: string,
  subject: string,
  bodyText: string,
  bodyHtml: string,
  fromName: string = ""
): number {
  const db = getWritableDb();
  // Ensure from_name column exists (migration for existing DBs)
  try { db.prepare("ALTER TABLE newsletter_emails ADD COLUMN from_name TEXT DEFAULT ''").run(); } catch {}
  const result = db.prepare(
    `INSERT INTO newsletter_emails
     (user_id, message_id, from_address, from_name, to_address, subject, body_text, body_html)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(userId, messageId, fromAddress, fromName, toAddress, subject, bodyText, bodyHtml);
  db.close();
  return Number(result.lastInsertRowid);
}

export function getFirstActiveUserId(): number | null {
  const row = getDb().prepare(
    "SELECT id FROM users WHERE is_active = 1 ORDER BY id ASC LIMIT 1"
  ).get() as { id: number } | undefined;
  return row?.id ?? null;
}

export interface NewsletterEmail {
  id: number;
  from_address: string;
  from_name: string;
  to_address: string;
  subject: string;
  received_at: string;
  processed: number;
  is_confirmation: number;
  confirmation_clicked: number;
  digest_date: string | null;
}

export function getNewsletterEmails(userId: number, limit = 100): NewsletterEmail[] {
  return getDb()
    .prepare(
      `SELECT id, from_address, COALESCE(from_name, '') as from_name,
              to_address, subject, received_at, processed,
              is_confirmation, confirmation_clicked, digest_date
       FROM newsletter_emails WHERE user_id = ?
       ORDER BY received_at DESC LIMIT ?`
    )
    .all(userId, limit) as NewsletterEmail[];
}

export function deleteNewsletterEmail(userId: number, emailId: number): void {
  const db = getWritableDb();
  db.prepare("DELETE FROM newsletter_emails WHERE id = ? AND user_id = ?").run(emailId, userId);
  db.close();
}

export function getNewsletterEmailBody(userId: number, emailId: number): { body_html: string | null; body_text: string | null; summary: string | null; subject: string | null; from_address: string | null; from_name: string | null; received_at: string | null } | null {
  // Ensure columns exist
  const wdb = getWritableDb();
  try { wdb.prepare("ALTER TABLE newsletter_emails ADD COLUMN summary TEXT").run(); } catch {}
  try { wdb.prepare("ALTER TABLE newsletter_emails ADD COLUMN from_name TEXT DEFAULT ''").run(); } catch {}
  wdb.close();

  const row = getDb()
    .prepare("SELECT body_html, body_text, summary, subject, from_address, COALESCE(from_name, '') as from_name, received_at FROM newsletter_emails WHERE id = ? AND user_id = ?")
    .get(emailId, userId) as { body_html: string | null; body_text: string | null; summary: string | null; subject: string | null; from_address: string | null; from_name: string | null; received_at: string | null } | undefined;
  return row ?? null;
}

export interface DigestRun {
  id: number;
  digest_date: string;
  email_count: number;
  started_at: string;
  finished_at: string | null;
  status: string;
  error: string | null;
  subject: string | null;
  schedule_name: string | null;
}

export function getDigestRuns(userId: number, limit = 20): DigestRun[] {
  // Ensure new columns exist (idempotent migrations)
  const wdb = getWritableDb();
  for (const col of ["subject TEXT", "schedule_name TEXT"]) {
    try { wdb.prepare(`ALTER TABLE newsletter_digest_runs ADD COLUMN ${col}`).run(); } catch { /* exists */ }
  }
  wdb.close();

  return getDb()
    .prepare(
      `SELECT id, digest_date, email_count, started_at, finished_at, status, error, subject, schedule_name
       FROM newsletter_digest_runs WHERE user_id = ?
       ORDER BY started_at DESC LIMIT ?`
    )
    .all(userId, limit) as DigestRun[];
}

export function deleteDigestRun(userId: number, runId: number): void {
  const db = getWritableDb();
  db.prepare("DELETE FROM newsletter_digest_runs WHERE id = ? AND user_id = ?").run(runId, userId);
  db.close();
}

export function getDigestRunHtml(userId: number, runId: number): string | null {
  // Ensure column exists
  const db = getWritableDb();
  try {
    db.prepare("ALTER TABLE newsletter_digest_runs ADD COLUMN digest_html TEXT").run();
  } catch {
    // Column already exists
  }
  db.close();

  const row = getDb()
    .prepare("SELECT digest_html FROM newsletter_digest_runs WHERE id = ? AND user_id = ?")
    .get(runId, userId) as { digest_html: string | null } | undefined;
  return row?.digest_html ?? null;
}

export interface NewsletterSubscription {
  from_address: string;
  from_name: string;
  to_address: string;
  email_count: number;
  last_received: string;
  latest_email_id: number;
  latest_subject: string | null;
}

export function getNewsletterSubscriptions(userId: number): NewsletterSubscription[] {
  return getDb()
    .prepare(
      `SELECT from_address,
              (SELECT COALESCE(from_name, '') FROM newsletter_emails ne4
               WHERE ne4.user_id = ? AND ne4.from_address = ne.from_address
               AND COALESCE(from_name, '') != ''
               ORDER BY received_at DESC LIMIT 1) as from_name,
              to_address, COUNT(*) as email_count,
              MAX(received_at) as last_received,
              (SELECT id FROM newsletter_emails ne2
               WHERE ne2.user_id = ? AND ne2.from_address = ne.from_address
               ORDER BY received_at DESC LIMIT 1) as latest_email_id,
              (SELECT subject FROM newsletter_emails ne3
               WHERE ne3.user_id = ? AND ne3.from_address = ne.from_address
               ORDER BY received_at DESC LIMIT 1) as latest_subject
       FROM newsletter_emails ne
       WHERE user_id = ? AND is_confirmation = 0
       GROUP BY from_address
       ORDER BY last_received DESC`
    )
    .all(userId, userId, userId, userId) as NewsletterSubscription[];
}

// ── Oneshot / Digest helpers ──────────────────────────────────

export function getUndigestedEmails(userId: number): { id: number; from_address: string; from_name: string; subject: string; body_text: string; received_at: string }[] {
  return getDb()
    .prepare(
      `SELECT id, from_address, COALESCE(from_name, '') as from_name, subject,
              COALESCE(body_text, '') as body_text, received_at
       FROM newsletter_emails
       WHERE user_id = ? AND processed = 1 AND is_confirmation = 0 AND digest_date IS NULL
       ORDER BY received_at ASC`
    )
    .all(userId) as any[];
}

export function getNewsletterSchedules(userId: number): { id: string; name: string; time: string; days: number[]; enabled: boolean }[] {
  const raw = getUserConfig(userId, "newsletter_schedules");
  if (!raw) return [];
  try {
    const schedules = JSON.parse(raw) as any[];
    return schedules.filter((s: any) => s.enabled !== false);
  } catch {
    return [];
  }
}

export function getRecentDigestTexts(userId: number, limit = 3): { id: number; digest_date: string; subject: string | null; digest_html: string }[] {
  const db = getWritableDb();
  try { db.prepare("ALTER TABLE newsletter_digest_runs ADD COLUMN digest_html TEXT").run(); } catch {}
  db.close();

  return getDb()
    .prepare(
      `SELECT id, digest_date, subject, digest_html FROM newsletter_digest_runs
       WHERE user_id = ? AND status = 'success' AND digest_html IS NOT NULL
       ORDER BY digest_date DESC LIMIT ?`
    )
    .all(userId, limit) as any[];
}

export function getLastDigestDate(userId: number): string | null {
  const row = getDb()
    .prepare(
      `SELECT digest_date FROM newsletter_digest_runs
       WHERE user_id = ? AND status = 'success'
       ORDER BY digest_date DESC LIMIT 1`
    )
    .get(userId) as { digest_date: string } | undefined;
  return row?.digest_date ?? null;
}

export function getLastScheduleRun(userId: number, scheduleId: string): string | null {
  return getUserConfig(userId, `newsletter_last_digest_${scheduleId}`);
}

export function setLastScheduleRun(userId: number, scheduleId: string, date: string): void {
  setUserConfig(userId, `newsletter_last_digest_${scheduleId}`, date);
}

export function insertDigestRun(userId: number, digestDate: string): number {
  const db = getWritableDb();
  const result = db.prepare(
    "INSERT INTO newsletter_digest_runs (user_id, digest_date) VALUES (?, ?)"
  ).run(userId, digestDate);
  db.close();
  return Number(result.lastInsertRowid);
}

export function finishDigestRun(
  runId: number,
  status: string,
  emailCount = 0,
  error: string | null = null,
  subject: string | null = null,
  scheduleName: string | null = null
): void {
  const db = getWritableDb();
  for (const col of ["subject TEXT", "schedule_name TEXT"]) {
    try { db.prepare(`ALTER TABLE newsletter_digest_runs ADD COLUMN ${col}`).run(); } catch {}
  }
  db.prepare(
    `UPDATE newsletter_digest_runs
     SET finished_at = datetime('now'), status = ?, email_count = ?, error = ?, subject = ?, schedule_name = ?
     WHERE id = ?`
  ).run(status, emailCount, error, subject, scheduleName, runId);
  db.close();
}

export function saveDigestHtml(runId: number, html: string): void {
  const db = getWritableDb();
  try { db.prepare("ALTER TABLE newsletter_digest_runs ADD COLUMN digest_html TEXT").run(); } catch {}
  db.prepare("UPDATE newsletter_digest_runs SET digest_html = ? WHERE id = ?").run(html, runId);
  db.close();
}

export function markEmailsDigested(emailIds: number[], digestDate: string): void {
  if (!emailIds.length) return;
  const db = getWritableDb();
  const placeholders = emailIds.map(() => "?").join(",");
  db.prepare(
    `UPDATE newsletter_emails SET digest_date = ? WHERE id IN (${placeholders})`
  ).run(digestDate, ...emailIds);
  db.close();
}

export function saveEmailSummary(emailId: number, summary: string): void {
  const db = getWritableDb();
  try { db.prepare("ALTER TABLE newsletter_emails ADD COLUMN summary TEXT").run(); } catch {}
  db.prepare("UPDATE newsletter_emails SET summary = ? WHERE id = ?").run(summary, emailId);
  db.close();
}

export function getNewsletterRecipients(userId: number): string[] {
  try {
    const raw = getUserConfig(userId, "newsletter_recipients");
    if (raw) {
      const recipients = JSON.parse(raw);
      if (Array.isArray(recipients) && recipients.length) return recipients;
    }
  } catch {}
  // Fallback: old single-email key
  const old = getUserConfig(userId, "newsletter_digest_email") || "";
  if (old) return [old];
  // Fallback: main email_recipient
  const main = getUserConfig(userId, "email_recipient") || "";
  return main ? [main] : [];
}

// ── IG Feed Digest helpers ────────────────────────────────────

export function getPostsSince(userId: number, sinceDate: string): UnifiedFeedItem[] {
  const db = getDb();
  const sql = `
    SELECT p.id, p.username AS source_name, p.type, p.caption AS content, p.timestamp, p.permalink,
           'instagram' AS platform, NULL AS comment_count
    FROM posts p WHERE p.user_id = ? AND p.timestamp >= ?
    UNION ALL
    SELECT fp.id, fg.name AS source_name, 'fb_post' AS type, fp.content, fp.timestamp, fp.permalink,
           'facebook' AS platform, fp.comment_count
    FROM fb_posts fp JOIN fb_groups fg ON fp.group_id = fg.group_id
    WHERE fg.user_id = ? AND fp.timestamp >= ?
    ORDER BY timestamp DESC
  `;
  return db.prepare(sql).all(userId, sinceDate, userId, sinceDate) as UnifiedFeedItem[];
}

export function getLastIgDigestDate(userId: number): string | null {
  return getUserConfig(userId, "ig_last_digest");
}

export function setLastIgDigestDate(userId: number, date: string): void {
  setUserConfig(userId, "ig_last_digest", date);
}

// ── Unified Feed ──────────────────────────────────────────────

export function getUnifiedFeed(
  userId: number,
  limit = 20,
  offset = 0,
  account?: string,
  type?: string,
  platform?: string,
  groupId?: string
): UnifiedFeedItem[] {
  const db = getDb();

  // Build IG conditions
  const igConditions: string[] = ["p.user_id = ?"];
  const igParams: any[] = [userId];
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
  const fbConditions: string[] = ["fg.user_id = ?"];
  const fbParams: any[] = [userId];
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

  const igWhere = `WHERE ${igConditions.join(" AND ")}`;
  const fbWhere = `WHERE ${fbConditions.join(" AND ")}`;

  const sql = `
    SELECT p.id, p.username AS source_name, p.type, p.caption AS content, p.timestamp, p.permalink,
           'instagram' AS platform, NULL AS comment_count
    FROM posts p ${igWhere}
    UNION ALL
    SELECT fp.id, fg.name AS source_name, 'fb_post' AS type, fp.content, fp.timestamp, fp.permalink,
           'facebook' AS platform, fp.comment_count
    FROM fb_posts fp JOIN fb_groups fg ON fp.group_id = fg.group_id ${fbWhere}
    ORDER BY timestamp DESC
    LIMIT ? OFFSET ?
  `;
  const params = [...igParams, ...fbParams, limit, offset];
  return db.prepare(sql).all(...params) as UnifiedFeedItem[];
}
