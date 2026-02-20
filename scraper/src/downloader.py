import logging
import os
import subprocess
from curl_cffi import requests
from PIL import Image

logger = logging.getLogger(__name__)

THUMBNAIL_SIZE = (400, 400)


class MediaDownloader:
    def __init__(self, media_dir: str):
        self.media_dir = media_dir
        self._session = requests.Session(impersonate="chrome131")

    def _get_extension(self, url: str, content_type: str = "") -> str:
        if "video" in content_type or url.split("?")[0].endswith(".mp4"):
            return ".mp4"
        return ".jpg"

    def _build_path(self, username: str, post_id: str, order: int, ext: str) -> str:
        return os.path.join(username, post_id, f"{order}{ext}")

    def download(self, url: str, username: str, post_id: str, order: int) -> str:
        rel_path = self._build_path(username, post_id, order, self._get_extension(url))
        full_path = os.path.join(self.media_dir, rel_path)

        if os.path.exists(full_path):
            return rel_path

        os.makedirs(os.path.dirname(full_path), exist_ok=True)
        try:
            response = self._session.get(url, timeout=120)
            with open(full_path, "wb") as f:
                f.write(response.content)
        except Exception as e:
            logger.warning(f"Download failed for {username}/{post_id}/{order}: {e}")
            return None

        return rel_path

    def download_with_thumbnail(self, url: str, username: str, post_id: str,
                                 order: int) -> tuple[str | None, str | None]:
        rel_path = self.download(url, username, post_id, order)
        if rel_path is None:
            return None, None
        full_path = os.path.join(self.media_dir, rel_path)

        if rel_path.endswith(".mp4"):
            thumb_rel = rel_path.replace(".mp4", "_thumb.jpg")
            thumb_full = os.path.join(self.media_dir, thumb_rel)
            if not os.path.exists(thumb_full):
                try:
                    subprocess.run(
                        [
                            "ffmpeg", "-loglevel", "error",
                            "-i", full_path,
                            "-ss", "00:00:00.5",
                            "-vframes", "1",
                            "-y", thumb_full,
                        ],
                        capture_output=True, timeout=30,
                    )
                    if os.path.exists(thumb_full):
                        img = Image.open(thumb_full)
                        img.thumbnail(THUMBNAIL_SIZE)
                        img.save(thumb_full, "JPEG", quality=80)
                    else:
                        return rel_path, None
                except Exception:
                    return rel_path, None
            return rel_path, thumb_rel

        thumb_rel = rel_path.replace(".jpg", "_thumb.jpg")
        thumb_full = os.path.join(self.media_dir, thumb_rel)

        if not os.path.exists(thumb_full):
            try:
                img = Image.open(full_path)
                img.thumbnail(THUMBNAIL_SIZE)
                img.save(thumb_full, "JPEG", quality=80)
            except Exception:
                return rel_path, None

        return rel_path, thumb_rel
