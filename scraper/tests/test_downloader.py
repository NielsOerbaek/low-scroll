import os
import tempfile
from unittest.mock import patch, MagicMock
import pytest
from src.downloader import MediaDownloader


@pytest.fixture
def media_dir():
    with tempfile.TemporaryDirectory() as tmpdir:
        yield tmpdir


def test_download_creates_directory_structure(media_dir):
    downloader = MediaDownloader(media_dir)
    with patch("src.downloader.requests.get") as mock_get:
        mock_response = MagicMock()
        mock_response.content = b"fake image data"
        mock_response.headers = {"content-type": "image/jpeg"}
        mock_get.return_value = mock_response

        path = downloader.download("https://example.com/photo.jpg", "testuser", "post123", 0)

    assert os.path.exists(os.path.join(media_dir, path))
    assert "testuser" in path
    assert "post123" in path


def test_download_creates_thumbnail(media_dir):
    downloader = MediaDownloader(media_dir)
    with patch("src.downloader.requests.get") as mock_get, \
         patch("src.downloader.Image") as mock_image:
        mock_response = MagicMock()
        mock_response.content = b"fake image data"
        mock_response.headers = {"content-type": "image/jpeg"}
        mock_get.return_value = mock_response

        mock_img = MagicMock()
        mock_image.open.return_value = mock_img

        path, thumb_path = downloader.download_with_thumbnail(
            "https://example.com/photo.jpg", "testuser", "post123", 0
        )

    assert thumb_path is not None
    mock_img.thumbnail.assert_called_once()


def test_skip_download_if_exists(media_dir):
    downloader = MediaDownloader(media_dir)
    os.makedirs(os.path.join(media_dir, "testuser", "post123"), exist_ok=True)
    filepath = os.path.join(media_dir, "testuser", "post123", "0.jpg")
    with open(filepath, "w") as f:
        f.write("existing")

    with patch("src.downloader.requests.get") as mock_get:
        path = downloader.download("https://example.com/photo.jpg", "testuser", "post123", 0)

    mock_get.assert_not_called()
