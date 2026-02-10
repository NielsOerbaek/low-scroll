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


def test_initialize_creates_manual_runs_table(db):
    tables = db.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
    table_names = {row["name"] for row in tables}
    assert "manual_runs" in table_names


def test_manual_run_lifecycle(db):
    run_id = db.insert_manual_run("2026-01-01")
    run = db.get_pending_manual_run()
    assert run is not None
    assert run["id"] == run_id
    assert run["since_date"] == "2026-01-01"
    assert run["status"] == "pending"

    db.start_manual_run(run_id)
    assert db.get_pending_manual_run() is None

    db.finish_manual_run(run_id, "success", new_posts=5, new_stories=2)
    runs = db.get_recent_manual_runs()
    assert len(runs) == 1
    assert runs[0]["status"] == "success"
    assert runs[0]["new_posts_count"] == 5
    assert runs[0]["new_stories_count"] == 2


def test_manual_run_error(db):
    run_id = db.insert_manual_run("2026-01-01")
    db.start_manual_run(run_id)
    db.finish_manual_run(run_id, "error", error="Something went wrong")
    runs = db.get_recent_manual_runs()
    assert runs[0]["error"] == "Something went wrong"


def test_reset_stale_manual_runs(db):
    run_id = db.insert_manual_run("2026-01-01")
    db.execute(
        "UPDATE manual_runs SET status='running', started_at=datetime('now', '-2 hours') WHERE id=?",
        (run_id,),
    )
    db.conn.commit()
    db.reset_stale_manual_runs()
    runs = db.get_recent_manual_runs()
    assert runs[0]["status"] == "error"
    assert "Stale" in runs[0]["error"]


def test_manual_run_log(db):
    run_id = db.insert_manual_run("2026-01-01")
    db.append_manual_run_log(run_id, "Starting scrape...")
    db.append_manual_run_log(run_id, "Scraped user1: 3 posts")
    log = db.get_manual_run_log(run_id)
    assert "Starting scrape..." in log
    assert "Scraped user1: 3 posts" in log
    assert log.count("\n") == 2


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
    db.upsert_account("iguser", None)
    db.insert_post(
        id="ig_1", username="iguser", post_type="post",
        caption="IG post", timestamp="2026-01-15T12:00:00", permalink="",
    )
    db.upsert_fb_group("123", "Test Group", "https://facebook.com/groups/123")
    db.insert_fb_post(
        id="fb_1", group_id="123", author_name="John",
        content="FB post", timestamp="2026-01-15T14:00:00",
        permalink="", comment_count=0,
    )
    feed = db.get_unified_feed(limit=10, offset=0)
    assert len(feed) == 2
    assert feed[0]["platform"] == "facebook"
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
