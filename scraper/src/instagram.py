import logging
import time
import random
from datetime import datetime, timezone
from curl_cffi import requests
from curl_cffi.requests.exceptions import HTTPError

logger = logging.getLogger(__name__)

BASE = "https://www.instagram.com"


class InstagramClient:
    def __init__(self, cookies: dict[str, str]):
        self._session = requests.Session(impersonate="chrome131")

        # Set all cookies from the browser
        for name, value in cookies.items():
            self._session.cookies.set(name, value, domain=".instagram.com")

        # Browser-matching headers (curl_cffi handles most via impersonate,
        # but we need the Instagram-specific ones)
        self._session.headers.update({
            "X-IG-App-ID": "936619743392459",
            "X-CSRFToken": cookies.get("csrftoken", ""),
            "X-Requested-With": "XMLHttpRequest",
            "Referer": "https://www.instagram.com/",
            "Sec-Fetch-Dest": "empty",
            "Sec-Fetch-Mode": "cors",
            "Sec-Fetch-Site": "same-origin",
        })
        self._ds_user_id = cookies.get("ds_user_id", "")
        self._username = None

    def _get(self, path: str, params: dict | None = None) -> dict:
        # Small random delay before every request to mimic human browsing
        time.sleep(random.uniform(1.0, 3.0))
        for attempt in range(4):
            resp = self._session.get(f"{BASE}{path}", params=params)
            if resp.status_code == 429:
                wait = int(resp.headers.get("Retry-After", 60 * (attempt + 1)))
                logger.warning(f"Rate limited (attempt {attempt + 1}/4), waiting {wait}s...")
                time.sleep(wait)
                continue
            if resp.status_code >= 500:
                wait = 5 * (attempt + 1) + random.uniform(0, 5)
                logger.warning(f"Server error {resp.status_code} on {path} (attempt {attempt + 1}/4), retrying in {wait:.0f}s...")
                time.sleep(wait)
                continue
            resp.raise_for_status()
            return resp.json()
        resp.raise_for_status()
        return resp.json()

    def validate_session(self) -> bool | None:
        """Returns True if valid, False if invalid/stale, None if rate limited."""
        try:
            data = self._get("/api/v1/users/web_profile_info/", {"username": "instagram"})
            return "data" in data and "user" in data["data"]
        except HTTPError as e:
            if e.response is not None and e.response.status_code == 429:
                logger.warning("Session validation skipped: rate limited")
                return None  # Can't tell, don't mark stale
            logger.warning(f"Session validation failed: {e}")
            return False
        except Exception as e:
            logger.warning(f"Session validation failed: {e}")
            return False

    def get_logged_in_username(self) -> str:
        if self._username:
            return self._username
        try:
            following = self._get(f"/api/v1/friendships/{self._ds_user_id}/following/", {"count": "1"})
            # If we can fetch our following, session is valid; get username from profile
            data = self._get("/api/v1/users/web_profile_info/", {"username": "instagram"})
            self._username = self._ds_user_id  # fallback to user ID
            return self._username
        except Exception:
            return "unknown"

    def _resolve_user_id(self, username: str) -> str:
        data = self._get("/api/v1/users/web_profile_info/", {"username": username})
        return data["data"]["user"]["id"]

    def get_following(self) -> list[dict]:
        result = []
        max_id = None
        while True:
            params = {"count": "100"}
            if max_id:
                params["max_id"] = max_id
            data = self._get(f"/api/v1/friendships/{self._ds_user_id}/following/", params)
            for u in data.get("users", []):
                result.append({"username": u["username"], "pk": u["pk"]})
            if not data.get("next_max_id"):
                break
            max_id = data["next_max_id"]
            self.random_delay(3.0, 8.0)
        return result

    def get_user_posts(self, username: str, amount: int = 20) -> list[dict]:
        posts = []
        max_id = None
        while len(posts) < amount:
            params = {"count": str(min(amount - len(posts), 12))}
            if max_id:
                params["max_id"] = max_id
            data = self._get(f"/api/v1/feed/user/{username}/username/", params)

            for item in data.get("items", []):
                media_items = []
                if item.get("carousel_media"):
                    for i, cm in enumerate(item["carousel_media"]):
                        is_video = bool(cm.get("video_versions"))
                        url = cm["video_versions"][0]["url"] if is_video else cm["image_versions2"]["candidates"][0]["url"]
                        media_items.append({"type": "video" if is_video else "image", "url": url, "order": i})
                else:
                    is_video = bool(item.get("video_versions"))
                    url = item["video_versions"][0]["url"] if is_video else item["image_versions2"]["candidates"][0]["url"]
                    media_items.append({"type": "video" if is_video else "image", "url": url, "order": 0})

                media_type = item.get("media_type", 1)
                taken_at = item.get("taken_at", 0)
                ts = datetime.fromtimestamp(taken_at, tz=timezone.utc).isoformat() if taken_at else ""
                posts.append({
                    "id": str(item["pk"]),
                    "caption": (item.get("caption") or {}).get("text", ""),
                    "timestamp": ts,
                    "permalink": f"https://www.instagram.com/p/{item['code']}/",
                    "post_type": "reel" if media_type == 2 and item.get("video_versions") else "post",
                    "media": media_items,
                })

            if not data.get("next_max_id"):
                break
            max_id = data["next_max_id"]
            self.random_delay(3.0, 8.0)

        return posts[:amount]

    def get_user_stories(self, username: str) -> list[dict]:
        user_id = self._resolve_user_id(username)
        self.random_delay(0.5, 1.5)

        data = self._get("/api/v1/feed/reels_media/", {"reel_ids": user_id})
        reel = data.get("reels", {}).get(str(user_id), {})
        result = []
        for s in reel.get("items", []):
            is_video = bool(s.get("video_versions"))
            url = s["video_versions"][0]["url"] if is_video else s["image_versions2"]["candidates"][0]["url"]
            taken_at = s.get("taken_at", 0)
            ts = datetime.fromtimestamp(taken_at, tz=timezone.utc).isoformat() if taken_at else ""
            result.append({
                "id": str(s["pk"]),
                "caption": "",
                "timestamp": ts,
                "permalink": f"https://www.instagram.com/stories/{username}/{s['pk']}/",
                "post_type": "story",
                "media": [{"type": "video" if is_video else "image", "url": url, "order": 0}],
            })
        return result

    def get_user_profile_pic(self, username: str) -> str:
        data = self._get("/api/v1/users/web_profile_info/", {"username": username})
        return data["data"]["user"].get("profile_pic_url", "")

    @staticmethod
    def random_delay(min_s: float = 1.0, max_s: float = 3.0):
        time.sleep(random.uniform(min_s, max_s))
