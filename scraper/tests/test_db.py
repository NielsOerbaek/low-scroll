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


@pytest.fixture
def user_id(db):
    """Create a default test user and return its id."""
    return db.insert_user("test@example.com", "hashed_pw")


@pytest.fixture
def user_id_2(db):
    """Create a second test user and return its id."""
    return db.insert_user("other@example.com", "hashed_pw_2")


# ── Schema ─────────────────────────────────────────────────────

def test_initialize_creates_tables(db):
    tables = db.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
    table_names = {row["name"] for row in tables}
    assert "users" in table_names
    assert "sessions" in table_names
    assert "user_config" in table_names
    assert "accounts" in table_names
    assert "posts" in table_names
    assert "media" in table_names
    assert "scrape_runs" in table_names
    assert "manual_runs" in table_names
    assert "fb_groups" in table_names
    assert "fb_posts" in table_names
    assert "fb_comments" in table_names


def test_initialize_no_config_table(db):
    tables = db.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
    table_names = {row["name"] for row in tables}
    assert "config" not in table_names


# ── Users ──────────────────────────────────────────────────────

def test_insert_user(db):
    uid = db.insert_user("alice@example.com", "hash123")
    assert uid is not None
    assert uid > 0


def test_get_user_by_email(db, user_id):
    user = db.get_user_by_email("test@example.com")
    assert user is not None
    assert user["id"] == user_id
    assert user["email"] == "test@example.com"
    assert user["password_hash"] == "hashed_pw"
    assert user["is_admin"] == 0
    assert user["is_active"] == 1


def test_get_user_by_email_not_found(db):
    assert db.get_user_by_email("nonexistent@example.com") is None


def test_get_user_by_id(db, user_id):
    user = db.get_user_by_id(user_id)
    assert user is not None
    assert user["email"] == "test@example.com"


def test_get_user_by_id_not_found(db):
    assert db.get_user_by_id(999) is None


def test_insert_user_duplicate_email(db, user_id):
    import sqlite3
    with pytest.raises(sqlite3.IntegrityError):
        db.insert_user("test@example.com", "different_hash")


def test_get_all_active_users(db, user_id, user_id_2):
    # Only users with ig_cookies should be returned
    db.set_user_config(user_id, "ig_cookies", "encrypted_blob")
    db.set_user_config(user_id_2, "ig_cookies", "encrypted_blob_2")
    users = db.get_all_active_users()
    assert len(users) == 2


def test_get_all_active_users_requires_cookies(db, user_id, user_id_2):
    # Only user_id has cookies, so only 1 returned
    db.set_user_config(user_id, "ig_cookies", "encrypted_blob")
    users = db.get_all_active_users()
    assert len(users) == 1
    assert users[0]["id"] == user_id


def test_deactivate_user(db, user_id, user_id_2):
    db.set_user_config(user_id, "ig_cookies", "encrypted_blob")
    db.set_user_config(user_id_2, "ig_cookies", "encrypted_blob_2")
    db.deactivate_user(user_id)
    users = db.get_all_active_users()
    assert len(users) == 1
    assert users[0]["id"] == user_id_2


# ── Sessions ───────────────────────────────────────────────────

def test_insert_and_get_session(db, user_id):
    db.insert_session("token123", user_id, "2099-12-31T23:59:59")
    session = db.get_session("token123")
    assert session is not None
    assert session["user_id"] == user_id
    assert session["token"] == "token123"


def test_get_session_expired(db, user_id):
    db.insert_session("expired_token", user_id, "2000-01-01T00:00:00")
    session = db.get_session("expired_token")
    assert session is None


def test_get_session_not_found(db):
    assert db.get_session("nonexistent") is None


def test_delete_session(db, user_id):
    db.insert_session("token123", user_id, "2099-12-31T23:59:59")
    db.delete_session("token123")
    assert db.get_session("token123") is None


def test_delete_expired_sessions(db, user_id):
    db.insert_session("valid_token", user_id, "2099-12-31T23:59:59")
    db.insert_session("expired_token", user_id, "2000-01-01T00:00:00")
    db.delete_expired_sessions()
    assert db.get_session("valid_token") is not None
    # expired one was already not returned by get_session, verify it's deleted from table
    row = db.execute("SELECT * FROM sessions WHERE token='expired_token'").fetchone()
    assert row is None


# ── User Config ────────────────────────────────────────────────

def test_set_and_get_user_config(db, user_id):
    db.set_user_config(user_id, "cron_schedule", "0 8 * * *")
    assert db.get_user_config(user_id, "cron_schedule") == "0 8 * * *"


def test_user_config_upsert(db, user_id):
    db.set_user_config(user_id, "cron_schedule", "0 8 * * *")
    db.set_user_config(user_id, "cron_schedule", "0 9 * * *")
    assert db.get_user_config(user_id, "cron_schedule") == "0 9 * * *"


def test_user_config_not_found(db, user_id):
    assert db.get_user_config(user_id, "nonexistent") is None


def test_user_config_scoped_to_user(db, user_id, user_id_2):
    db.set_user_config(user_id, "theme", "dark")
    db.set_user_config(user_id_2, "theme", "light")
    assert db.get_user_config(user_id, "theme") == "dark"
    assert db.get_user_config(user_id_2, "theme") == "light"


# ── Instagram Accounts ─────────────────────────────────────────

def test_upsert_account(db, user_id):
    db.upsert_account(user_id, "testuser", "/pics/test.jpg")
    account = db.get_account(user_id, "testuser")
    assert account["username"] == "testuser"
    assert account["profile_pic_path"] == "/pics/test.jpg"


def test_upsert_account_updates_pic(db, user_id):
    db.upsert_account(user_id, "testuser", "/pics/old.jpg")
    db.upsert_account(user_id, "testuser", "/pics/new.jpg")
    account = db.get_account(user_id, "testuser")
    assert account["profile_pic_path"] == "/pics/new.jpg"


def test_get_all_accounts(db, user_id, user_id_2):
    db.upsert_account(user_id, "user_a", None)
    db.upsert_account(user_id, "user_b", None)
    db.upsert_account(user_id_2, "user_c", None)
    assert len(db.get_all_accounts(user_id)) == 2
    assert len(db.get_all_accounts(user_id_2)) == 1


def test_accounts_scoped_to_user(db, user_id, user_id_2):
    db.upsert_account(user_id, "sharedname", "/pics/u1.jpg")
    db.upsert_account(user_id_2, "sharedname", "/pics/u2.jpg")
    acc1 = db.get_account(user_id, "sharedname")
    acc2 = db.get_account(user_id_2, "sharedname")
    assert acc1["profile_pic_path"] == "/pics/u1.jpg"
    assert acc2["profile_pic_path"] == "/pics/u2.jpg"


def test_update_last_checked(db, user_id):
    db.upsert_account(user_id, "testuser", None)
    db.update_last_checked(user_id, "testuser")
    account = db.get_account(user_id, "testuser")
    assert account["last_checked_at"] is not None


# ── Instagram Posts ────────────────────────────────────────────

def test_insert_post(db, user_id):
    db.upsert_account(user_id, "testuser", None)
    result = db.insert_post(
        user_id=user_id,
        id="abc123",
        username="testuser",
        post_type="post",
        caption="Hello world",
        timestamp="2026-01-01T00:00:00",
        permalink="https://instagram.com/p/abc123",
    )
    assert result is True
    post = db.get_post("abc123")
    assert post["caption"] == "Hello world"
    assert post["type"] == "post"
    assert post["user_id"] == user_id


def test_insert_post_duplicate(db, user_id):
    db.upsert_account(user_id, "testuser", None)
    db.insert_post(
        user_id=user_id, id="abc123", username="testuser",
        post_type="post", caption="", timestamp="2026-01-01T00:00:00", permalink="",
    )
    result = db.insert_post(
        user_id=user_id, id="abc123", username="testuser",
        post_type="post", caption="", timestamp="2026-01-01T00:00:00", permalink="",
    )
    assert result is False


def test_same_post_id_different_users(db, user_id, user_id_2):
    """Two users following the same account can both store the same post."""
    db.upsert_account(user_id, "shared_acct", None)
    db.upsert_account(user_id_2, "shared_acct", None)
    r1 = db.insert_post(
        user_id=user_id, id="same_id", username="shared_acct",
        post_type="post", caption="", timestamp="2026-01-01T00:00:00", permalink="",
    )
    r2 = db.insert_post(
        user_id=user_id_2, id="same_id", username="shared_acct",
        post_type="post", caption="", timestamp="2026-01-01T00:00:00", permalink="",
    )
    assert r1 is True
    assert r2 is True
    assert len(db.get_feed(user_id)) == 1
    assert len(db.get_feed(user_id_2)) == 1


def test_insert_media(db, user_id):
    db.upsert_account(user_id, "testuser", None)
    db.insert_post(
        user_id=user_id, id="abc123", username="testuser",
        post_type="post", caption="", timestamp="2026-01-01T00:00:00", permalink="",
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


def test_get_feed_paginated(db, user_id):
    db.upsert_account(user_id, "testuser", None)
    for i in range(5):
        db.insert_post(
            user_id=user_id, id=f"post_{i}", username="testuser",
            post_type="post", caption=f"Post {i}",
            timestamp=f"2026-01-0{i+1}T00:00:00", permalink="",
        )
    page = db.get_feed(user_id, limit=2, offset=0)
    assert len(page) == 2
    assert page[0]["id"] == "post_4"


def test_get_feed_scoped_to_user(db, user_id, user_id_2):
    db.upsert_account(user_id, "u1", None)
    db.upsert_account(user_id_2, "u2", None)
    db.insert_post(
        user_id=user_id, id="p1", username="u1",
        post_type="post", caption="", timestamp="2026-01-01T00:00:00", permalink="",
    )
    db.insert_post(
        user_id=user_id_2, id="p2", username="u2",
        post_type="post", caption="", timestamp="2026-01-02T00:00:00", permalink="",
    )
    assert len(db.get_feed(user_id)) == 1
    assert len(db.get_feed(user_id_2)) == 1


def test_get_new_posts_since(db, user_id):
    db.upsert_account(user_id, "testuser", None)
    db.insert_post(
        user_id=user_id, id="p1", username="testuser",
        post_type="post", caption="", timestamp="2026-01-01T00:00:00", permalink="",
    )
    posts = db.get_new_posts_since(user_id, "2000-01-01")
    assert len(posts) == 1
    assert posts[0]["id"] == "p1"


def test_get_new_posts_since_scoped(db, user_id, user_id_2):
    db.upsert_account(user_id, "u1", None)
    db.upsert_account(user_id_2, "u2", None)
    db.insert_post(
        user_id=user_id, id="p1", username="u1",
        post_type="post", caption="", timestamp="2026-01-01T00:00:00", permalink="",
    )
    db.insert_post(
        user_id=user_id_2, id="p2", username="u2",
        post_type="post", caption="", timestamp="2026-01-02T00:00:00", permalink="",
    )
    assert len(db.get_new_posts_since(user_id, "2000-01-01")) == 1
    assert len(db.get_new_posts_since(user_id_2, "2000-01-01")) == 1


# ── Scrape Runs ────────────────────────────────────────────────

def test_insert_scrape_run(db, user_id):
    run_id = db.insert_scrape_run(user_id)
    db.finish_scrape_run(run_id, status="success", new_posts=3, new_stories=1)
    run = db.get_scrape_run(run_id)
    assert run["status"] == "success"
    assert run["new_posts_count"] == 3
    assert run["user_id"] == user_id


def test_scrape_run_log(db, user_id):
    run_id = db.insert_scrape_run(user_id)
    db.append_scrape_run_log(run_id, "Starting...")
    db.append_scrape_run_log(run_id, "Done")
    run = db.get_scrape_run(run_id)
    assert "Starting..." in run["log"]
    assert "Done" in run["log"]


def test_get_recent_scrape_runs_scoped(db, user_id, user_id_2):
    db.insert_scrape_run(user_id)
    db.insert_scrape_run(user_id_2)
    assert len(db.get_recent_scrape_runs(user_id)) == 1
    assert len(db.get_recent_scrape_runs(user_id_2)) == 1


def test_get_last_scrape_time(db, user_id):
    assert db.get_last_scrape_time(user_id) is None
    run_id = db.insert_scrape_run(user_id)
    db.finish_scrape_run(run_id, status="success")
    assert db.get_last_scrape_time(user_id) is not None


def test_get_last_scrape_time_only_success(db, user_id):
    run_id = db.insert_scrape_run(user_id)
    db.finish_scrape_run(run_id, status="error", error="fail")
    assert db.get_last_scrape_time(user_id) is None


# ── Manual Runs ────────────────────────────────────────────────

def test_manual_run_lifecycle(db, user_id):
    run_id = db.insert_manual_run(user_id, "2026-01-01")
    run = db.get_pending_manual_run(user_id)
    assert run is not None
    assert run["id"] == run_id
    assert run["since_date"] == "2026-01-01"
    assert run["status"] == "pending"
    assert run["user_id"] == user_id

    db.start_manual_run(run_id)
    assert db.get_pending_manual_run(user_id) is None

    db.finish_manual_run(run_id, "success", new_posts=5, new_stories=2)
    runs = db.get_recent_manual_runs(user_id)
    assert len(runs) == 1
    assert runs[0]["status"] == "success"
    assert runs[0]["new_posts_count"] == 5
    assert runs[0]["new_stories_count"] == 2


def test_manual_run_error(db, user_id):
    run_id = db.insert_manual_run(user_id, "2026-01-01")
    db.start_manual_run(run_id)
    db.finish_manual_run(run_id, "error", error="Something went wrong")
    runs = db.get_recent_manual_runs(user_id)
    assert runs[0]["error"] == "Something went wrong"


def test_reset_stale_manual_runs(db, user_id):
    run_id = db.insert_manual_run(user_id, "2026-01-01")
    db.execute(
        "UPDATE manual_runs SET status='running', started_at=datetime('now', '-2 hours') WHERE id=?",
        (run_id,),
    )
    db.conn.commit()
    db.reset_stale_manual_runs()
    runs = db.get_recent_manual_runs(user_id)
    assert runs[0]["status"] == "error"
    assert "Stale" in runs[0]["error"]


def test_manual_run_log(db, user_id):
    run_id = db.insert_manual_run(user_id, "2026-01-01")
    db.append_manual_run_log(run_id, "Starting scrape...")
    db.append_manual_run_log(run_id, "Scraped user1: 3 posts")
    log = db.get_manual_run_log(run_id)
    assert "Starting scrape..." in log
    assert "Scraped user1: 3 posts" in log
    assert log.count("\n") == 2


def test_manual_runs_scoped_to_user(db, user_id, user_id_2):
    db.insert_manual_run(user_id, "2026-01-01")
    db.insert_manual_run(user_id_2, "2026-02-01")
    assert len(db.get_recent_manual_runs(user_id)) == 1
    assert len(db.get_recent_manual_runs(user_id_2)) == 1
    assert db.get_pending_manual_run(user_id)["user_id"] == user_id
    assert db.get_pending_manual_run(user_id_2)["user_id"] == user_id_2


# ── Facebook Groups ────────────────────────────────────────────

def test_upsert_fb_group(db, user_id):
    db.upsert_fb_group(user_id, "123456", "Test Group", "https://facebook.com/groups/123456")
    group = db.get_fb_group(user_id, "123456")
    assert group["name"] == "Test Group"
    assert group["url"] == "https://facebook.com/groups/123456"


def test_get_all_fb_groups(db, user_id):
    db.upsert_fb_group(user_id, "111", "Group A", "https://facebook.com/groups/111")
    db.upsert_fb_group(user_id, "222", "Group B", "https://facebook.com/groups/222")
    groups = db.get_all_fb_groups(user_id)
    assert len(groups) == 2


def test_fb_groups_scoped_to_user(db, user_id, user_id_2):
    db.upsert_fb_group(user_id, "111", "Group A", "https://facebook.com/groups/111")
    db.upsert_fb_group(user_id_2, "222", "Group B", "https://facebook.com/groups/222")
    assert len(db.get_all_fb_groups(user_id)) == 1
    assert len(db.get_all_fb_groups(user_id_2)) == 1


def test_delete_fb_group(db, user_id):
    db.upsert_fb_group(user_id, "111", "Group A", "https://facebook.com/groups/111")
    db.delete_fb_group(user_id, "111")
    assert db.get_fb_group(user_id, "111") is None


def test_delete_fb_group_cascades_posts_and_comments(db, user_id):
    db.upsert_fb_group(user_id, "111", "Group A", "https://facebook.com/groups/111")
    db.insert_fb_post(
        id="fp1", group_id="111", author_name="John",
        content="Hello", timestamp="2026-01-01T00:00:00", permalink="",
    )
    db.insert_fb_comment("fp1", "Jane", "Nice!", "2026-01-01T01:00:00")
    db.delete_fb_group(user_id, "111")
    assert db.get_fb_post("fp1") is None
    assert len(db.get_comments_for_post("fp1")) == 0


def test_delete_fb_group_shared_preserves_posts(db, user_id, user_id_2):
    """Deleting a shared group for one user preserves fb_posts for the other."""
    db.upsert_fb_group(user_id, "shared", "Shared Group", "https://facebook.com/groups/shared")
    db.upsert_fb_group(user_id_2, "shared", "Shared Group", "https://facebook.com/groups/shared")
    db.insert_fb_post(
        id="fp1", group_id="shared", author_name="John",
        content="Hello", timestamp="2026-01-01T00:00:00", permalink="",
    )
    db.insert_fb_comment("fp1", "Jane", "Nice!", "2026-01-01T01:00:00")
    # User 1 removes the group — posts should stay for user 2
    db.delete_fb_group(user_id, "shared")
    assert db.get_fb_group(user_id, "shared") is None
    assert db.get_fb_post("fp1") is not None
    assert len(db.get_comments_for_post("fp1")) == 1
    # User 2 removes the group — now posts should be cleaned up
    db.delete_fb_group(user_id_2, "shared")
    assert db.get_fb_post("fp1") is None
    assert len(db.get_comments_for_post("fp1")) == 0


def test_update_fb_group_last_checked(db, user_id):
    db.upsert_fb_group(user_id, "123", "Group", "https://facebook.com/groups/123")
    db.update_fb_group_last_checked(user_id, "123")
    group = db.get_fb_group(user_id, "123")
    assert group["last_checked_at"] is not None


# ── Facebook Posts & Comments ──────────────────────────────────

def test_insert_fb_post(db, user_id):
    db.upsert_fb_group(user_id, "123", "Test Group", "https://facebook.com/groups/123")
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


def test_insert_fb_post_duplicate(db, user_id):
    db.upsert_fb_group(user_id, "123", "Test Group", "https://facebook.com/groups/123")
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


def test_insert_fb_comment(db, user_id):
    db.upsert_fb_group(user_id, "123", "Test Group", "https://facebook.com/groups/123")
    db.insert_fb_post(
        id="fb_post_1", group_id="123", author_name="John",
        content="Hello", timestamp="2026-01-15T10:00:00",
        permalink="", comment_count=1,
    )
    db.insert_fb_comment("fb_post_1", "Jane", "Great post!", "2026-01-15T11:00:00", 0)
    comments = db.get_comments_for_post("fb_post_1")
    assert len(comments) == 1
    assert comments[0]["author_name"] == "Jane"


def test_get_new_fb_posts_since(db, user_id, user_id_2):
    db.upsert_fb_group(user_id, "123", "Group", "https://facebook.com/groups/123")
    db.upsert_fb_group(user_id_2, "456", "Other Group", "https://facebook.com/groups/456")
    db.insert_fb_post(
        id="fb_1", group_id="123", author_name="John",
        content="FB post", timestamp="2026-01-15T14:00:00",
        permalink="", comment_count=0,
    )
    db.insert_fb_post(
        id="fb_2", group_id="456", author_name="Jane",
        content="Other FB post", timestamp="2026-01-16T14:00:00",
        permalink="", comment_count=0,
    )
    posts_u1 = db.get_new_fb_posts_since(user_id, "2000-01-01")
    posts_u2 = db.get_new_fb_posts_since(user_id_2, "2000-01-01")
    assert len(posts_u1) == 1
    assert posts_u1[0]["id"] == "fb_1"
    assert len(posts_u2) == 1
    assert posts_u2[0]["id"] == "fb_2"


# ── Unified Feed ───────────────────────────────────────────────

def test_get_unified_feed(db, user_id):
    db.upsert_account(user_id, "iguser", None)
    db.insert_post(
        user_id=user_id, id="ig_1", username="iguser", post_type="post",
        caption="IG post", timestamp="2026-01-15T12:00:00", permalink="",
    )
    db.upsert_fb_group(user_id, "123", "Test Group", "https://facebook.com/groups/123")
    db.insert_fb_post(
        id="fb_1", group_id="123", author_name="John",
        content="FB post", timestamp="2026-01-15T14:00:00",
        permalink="", comment_count=0,
    )
    feed = db.get_unified_feed(user_id, limit=10, offset=0)
    assert len(feed) == 2
    assert feed[0]["platform"] == "facebook"
    assert feed[1]["platform"] == "instagram"


def test_get_unified_feed_filter_platform(db, user_id):
    db.upsert_account(user_id, "iguser", None)
    db.insert_post(
        user_id=user_id, id="ig_1", username="iguser", post_type="post",
        caption="IG post", timestamp="2026-01-15T12:00:00", permalink="",
    )
    db.upsert_fb_group(user_id, "123", "Group", "https://facebook.com/groups/123")
    db.insert_fb_post(
        id="fb_1", group_id="123", author_name="John",
        content="FB post", timestamp="2026-01-15T14:00:00",
        permalink="", comment_count=0,
    )
    fb_only = db.get_unified_feed(user_id, limit=10, offset=0, platform="facebook")
    assert len(fb_only) == 1
    assert fb_only[0]["platform"] == "facebook"
    ig_only = db.get_unified_feed(user_id, limit=10, offset=0, platform="instagram")
    assert len(ig_only) == 1
    assert ig_only[0]["platform"] == "instagram"


def test_get_unified_feed_filter_type(db, user_id):
    db.upsert_account(user_id, "iguser", None)
    db.insert_post(
        user_id=user_id, id="ig_1", username="iguser", post_type="story",
        caption="", timestamp="2026-01-15T12:00:00", permalink="",
    )
    db.upsert_fb_group(user_id, "123", "Group", "https://facebook.com/groups/123")
    db.insert_fb_post(
        id="fb_1", group_id="123", author_name="John",
        content="FB post", timestamp="2026-01-15T14:00:00",
        permalink="", comment_count=0,
    )
    stories = db.get_unified_feed(user_id, limit=10, offset=0, type="story")
    assert len(stories) == 1
    assert stories[0]["id"] == "ig_1"


def test_get_unified_feed_scoped_to_user(db, user_id, user_id_2):
    db.upsert_account(user_id, "iguser", None)
    db.insert_post(
        user_id=user_id, id="ig_1", username="iguser", post_type="post",
        caption="", timestamp="2026-01-15T12:00:00", permalink="",
    )
    db.upsert_account(user_id_2, "other", None)
    db.insert_post(
        user_id=user_id_2, id="ig_2", username="other", post_type="post",
        caption="", timestamp="2026-01-15T13:00:00", permalink="",
    )
    assert len(db.get_unified_feed(user_id, limit=10)) == 1
    assert len(db.get_unified_feed(user_id_2, limit=10)) == 1


# ── Delete Accounts Not In ─────────────────────────────────────

def test_delete_accounts_not_in(db, user_id):
    db.upsert_account(user_id, "keep_me", None)
    db.upsert_account(user_id, "remove_me", None)
    db.delete_accounts_not_in(user_id, ["keep_me"])
    accounts = db.get_all_accounts(user_id)
    assert len(accounts) == 1
    assert accounts[0]["username"] == "keep_me"


def test_delete_accounts_not_in_keeps_with_posts(db, user_id):
    db.upsert_account(user_id, "has_posts", None)
    db.insert_post(
        user_id=user_id, id="p1", username="has_posts",
        post_type="post", caption="", timestamp="2026-01-01T00:00:00", permalink="",
    )
    db.upsert_account(user_id, "no_posts", None)
    db.delete_accounts_not_in(user_id, ["other_user"])
    accounts = db.get_all_accounts(user_id)
    usernames = [a["username"] for a in accounts]
    assert "has_posts" in usernames
    assert "no_posts" not in usernames
