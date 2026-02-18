from unittest.mock import MagicMock, patch
import pytest
from src.instagram import InstagramClient


FAKE_COOKIES = {"sessionid": "fake_session", "csrftoken": "fake_csrf", "ds_user_id": "12345"}


def _make_client():
    """Create a client with a mocked requests session."""
    client = InstagramClient.__new__(InstagramClient)
    client._session = MagicMock()
    client._ds_user_id = "12345"
    client._username = None
    return client


def test_validate_session_returns_true_on_success():
    client = _make_client()
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {"data": {"user": {"username": "instagram"}}}
    client._session.get.return_value = mock_resp
    assert client.validate_session() is True


def test_validate_session_returns_false_on_failure():
    client = _make_client()
    client._session.get.side_effect = Exception("Connection error")
    assert client.validate_session() is False


def test_get_following_returns_usernames():
    client = _make_client()
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {
        "users": [{"username": "followed_user", "pk": 1}],
        "next_max_id": None,
    }
    client._session.get.return_value = mock_resp
    result = client.get_following()
    assert result == [{"username": "followed_user", "pk": 1}]


@patch.object(InstagramClient, "random_delay")
def test_get_user_posts(mock_delay):
    client = _make_client()

    feed_resp = MagicMock()
    feed_resp.status_code = 200
    feed_resp.json.return_value = {
        "items": [{
            "pk": "post123",
            "code": "abc",
            "caption": {"text": "Hello"},
            "taken_at": 1704067200,
            "media_type": 1,
            "image_versions2": {"candidates": [{"url": "https://example.com/thumb.jpg"}]},
        }],
        "next_max_id": None,
    }

    client._session.get.return_value = feed_resp
    result = client.get_user_posts("testuser", amount=1)
    assert len(result) == 1
    assert result[0]["id"] == "post123"
    assert result[0]["caption"] == "Hello"
    assert result[0]["permalink"] == "https://www.instagram.com/p/abc/"
    assert result[0]["username"] == "testuser"


@patch.object(InstagramClient, "random_delay")
def test_get_timeline_feed(mock_delay):
    client = _make_client()

    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {
        "items": [
            {
                "pk": "feed1",
                "code": "xyz",
                "caption": {"text": "Feed post"},
                "taken_at": 1704067200,
                "media_type": 1,
                "user": {"pk": 111, "username": "alice"},
                "image_versions2": {"candidates": [{"url": "https://example.com/img.jpg"}]},
            },
            {
                "pk": "feed2",
                "code": "abc",
                "caption": None,
                "taken_at": 1704070800,
                "media_type": 2,
                "user": {"pk": 222, "username": "bob"},
                "video_versions": [{"url": "https://example.com/vid.mp4"}],
            },
        ],
        "more_available": False,
    }
    client._session.get.return_value = mock_resp

    result = client.get_timeline_feed(pages=1)
    assert len(result) == 2
    assert result[0]["id"] == "feed1"
    assert result[0]["username"] == "alice"
    assert result[0]["post_type"] == "post"
    assert result[1]["id"] == "feed2"
    assert result[1]["username"] == "bob"
    assert result[1]["post_type"] == "reel"


@patch.object(InstagramClient, "random_delay")
def test_get_timeline_feed_media_or_ad_format(mock_delay):
    """Timeline can return feed_items with media_or_ad wrapper."""
    client = _make_client()

    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {
        "feed_items": [
            {
                "media_or_ad": {
                    "pk": "wrapped1",
                    "code": "w1",
                    "caption": {"text": "Wrapped"},
                    "taken_at": 1704067200,
                    "media_type": 1,
                    "user": {"pk": 333, "username": "charlie"},
                    "image_versions2": {"candidates": [{"url": "https://example.com/w.jpg"}]},
                },
            },
            {"end_of_feed_demarcator": {}},  # Non-post entry, should be skipped
        ],
        "more_available": False,
    }
    client._session.get.return_value = mock_resp

    result = client.get_timeline_feed(pages=1)
    assert len(result) == 1
    assert result[0]["id"] == "wrapped1"
    assert result[0]["username"] == "charlie"


@patch.object(InstagramClient, "random_delay")
def test_get_reels_tray_with_items(mock_delay):
    """Reels tray includes story items directly."""
    client = _make_client()

    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {
        "tray": [
            {
                "user": {"pk": 111, "username": "alice"},
                "items": [{
                    "pk": "story1",
                    "taken_at": 1704067200,
                    "image_versions2": {"candidates": [{"url": "https://example.com/s1.jpg"}]},
                }],
            },
        ],
    }
    client._session.get.return_value = mock_resp

    result = client.get_reels_tray()
    assert len(result) == 1
    assert result[0]["id"] == "story1"
    assert result[0]["username"] == "alice"
    assert result[0]["post_type"] == "story"
    assert result[0]["permalink"] == "https://www.instagram.com/stories/alice/story1/"


@patch.object(InstagramClient, "random_delay")
def test_get_reels_tray_needs_fetch(mock_delay):
    """Reels tray without items triggers individual fetch."""
    client = _make_client()

    tray_resp = MagicMock()
    tray_resp.status_code = 200
    tray_resp.json.return_value = {
        "tray": [
            {"user": {"pk": 111, "username": "alice"}, "items": []},
        ],
    }

    reel_resp = MagicMock()
    reel_resp.status_code = 200
    reel_resp.json.return_value = {
        "reels": {
            "111": {
                "user": {"pk": 111, "username": "alice"},
                "items": [{
                    "pk": "story2",
                    "taken_at": 1704067200,
                    "image_versions2": {"candidates": [{"url": "https://example.com/s2.jpg"}]},
                }],
            },
        },
    }

    client._session.get.side_effect = [tray_resp, reel_resp]

    result = client.get_reels_tray()
    assert len(result) == 1
    assert result[0]["id"] == "story2"
    assert result[0]["username"] == "alice"
