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

    total_posts, total_stories = scraper.scrape_all()
    assert total_posts >= 1
