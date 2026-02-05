from unittest.mock import MagicMock, patch
import pytest
from src.instagram import InstagramClient


def test_validate_session_returns_true_on_success():
    client = InstagramClient.__new__(InstagramClient)
    client._cl = MagicMock()
    client._cl.account_info.return_value = MagicMock(username="testuser")
    assert client.validate_session() is True


def test_validate_session_returns_false_on_failure():
    client = InstagramClient.__new__(InstagramClient)
    client._cl = MagicMock()
    client._cl.account_info.side_effect = Exception("Login required")
    assert client.validate_session() is False


def test_get_following_returns_usernames():
    client = InstagramClient.__new__(InstagramClient)
    client._cl = MagicMock()
    user_mock = MagicMock()
    user_mock.pk = 123
    client._cl.account_info.return_value = user_mock
    following_mock = MagicMock()
    following_mock.username = "followed_user"
    client._cl.user_following.return_value = {1: following_mock}
    result = client.get_following()
    assert result == [{"username": "followed_user", "pk": 1}]


def test_get_user_posts():
    client = InstagramClient.__new__(InstagramClient)
    client._cl = MagicMock()
    post_mock = MagicMock()
    post_mock.pk = "post123"
    post_mock.caption_text = "Hello"
    post_mock.taken_at = "2026-01-01T00:00:00"
    post_mock.code = "abc"
    post_mock.media_type = 1  # photo
    post_mock.resources = []
    post_mock.thumbnail_url = "https://example.com/thumb.jpg"
    post_mock.video_url = None

    user_mock = MagicMock()
    user_mock.pk = 456
    client._cl.user_id_from_username.return_value = 456
    client._cl.user_medias.return_value = [post_mock]

    result = client.get_user_posts("testuser", amount=1)
    assert len(result) == 1
    assert result[0]["id"] == "post123"
