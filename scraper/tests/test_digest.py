from unittest.mock import patch, MagicMock
import pytest
from src.digest import DigestBuilder


@pytest.fixture
def builder():
    return DigestBuilder(
        resend_api_key="re_test_key",
        base_url="https://ig.raakode.dk",
        from_email="digest@ig.raakode.dk",
    )


def test_build_html_contains_posts(builder):
    posts = [
        {
            "id": "post1",
            "username": "user1",
            "type": "post",
            "caption": "Hello world",
            "timestamp": "2026-01-01T00:00:00",
            "media": [{"thumbnail_path": "user1/post1/0_thumb.jpg", "media_type": "image"}],
        }
    ]
    html = builder.build_html(posts)
    assert "Hello world" in html
    assert "user1" in html
    assert "ig.raakode.dk" in html


def test_build_html_groups_by_account(builder):
    posts = [
        {"id": "p1", "username": "alice", "type": "post", "caption": "A",
         "timestamp": "2026-01-01T00:00:00", "media": []},
        {"id": "p2", "username": "bob", "type": "post", "caption": "B",
         "timestamp": "2026-01-01T01:00:00", "media": []},
        {"id": "p3", "username": "alice", "type": "story", "caption": "",
         "timestamp": "2026-01-01T02:00:00", "media": []},
    ]
    html = builder.build_html(posts)
    assert "alice" in html
    assert "bob" in html


def test_send_digest_calls_resend(builder):
    with patch("src.digest.resend") as mock_resend:
        mock_resend.Emails.send.return_value = {"id": "email123"}
        builder.send("test@example.com", "<h1>Digest</h1>", post_count=3)
        mock_resend.Emails.send.assert_called_once()
        call_args = mock_resend.Emails.send.call_args[1]
        assert call_args["to"] == ["test@example.com"]
        assert "3" in call_args["subject"]
