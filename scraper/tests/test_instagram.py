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
