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
    assert "abc123" not in raw


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


def test_store_and_retrieve_fb_cookies(cookie_manager):
    cookies = {"c_user": "123", "xs": "secret"}
    cookie_manager.store_fb_cookies(cookies)
    retrieved = cookie_manager.get_fb_cookies()
    assert retrieved == cookies


def test_get_fb_cookies_returns_none_when_empty(cookie_manager):
    assert cookie_manager.get_fb_cookies() is None


def test_fb_mark_stale_and_check(cookie_manager):
    cookie_manager.store_fb_cookies({"c_user": "123", "xs": "secret"})
    assert cookie_manager.is_fb_stale() is False
    cookie_manager.mark_fb_stale()
    assert cookie_manager.is_fb_stale() is True


def test_storing_new_fb_cookies_clears_stale(cookie_manager):
    cookie_manager.store_fb_cookies({"c_user": "123", "xs": "secret"})
    cookie_manager.mark_fb_stale()
    assert cookie_manager.is_fb_stale() is True
    cookie_manager.store_fb_cookies({"c_user": "456", "xs": "newsecret"})
    assert cookie_manager.is_fb_stale() is False
