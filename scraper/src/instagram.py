import logging
import time
import random
from datetime import datetime, timezone
from curl_cffi import requests
from curl_cffi.requests.exceptions import HTTPError

logger = logging.getLogger(__name__)

BASE = "https://www.instagram.com"


class SessionExpiredError(Exception):
    """Raised when Instagram returns 400/401/403, indicating an expired session."""
    pass


class InstagramClient:
    def __init__(self, cookies: dict[str, str]):
        self._session = requests.Session(impersonate="chrome131")

        # Set all cookies from the browser
        for name, value in cookies.items():
            self._session.cookies.set(name, value, domain=".instagram.com")

        self._session.headers.update({
            "X-IG-App-ID": "936619743392459",
            "X-CSRFToken": cookies.get("csrftoken", ""),
            "Sec-Fetch-Dest": "empty",
            "Sec-Fetch-Mode": "cors",
            "Sec-Fetch-Site": "same-origin",
        })
        self._ds_user_id = cookies.get("ds_user_id", "")
        self._username = None

    def _get(self, path: str, params: dict | None = None, referer: str | None = None) -> dict:
        time.sleep(random.uniform(0.3, 1.0))
        headers = {}
        if referer:
            headers["Referer"] = referer
        for attempt in range(4):
            resp = self._session.get(f"{BASE}{path}", params=params, headers=headers)
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
            if resp.status_code in (400, 401, 403):
                raise SessionExpiredError(f"HTTP {resp.status_code} on {path}")
            resp.raise_for_status()
            return resp.json()
        if resp.status_code in (400, 401, 403):
            raise SessionExpiredError(f"HTTP {resp.status_code} on {path} after retries")
        resp.raise_for_status()
        return resp.json()

    def browse_pause(self):
        """Simulate human browsing — occasional long pauses like reading content."""
        if random.random() < 0.1:
            time.sleep(random.uniform(15.0, 45.0))
        else:
            time.sleep(random.uniform(3.0, 12.0))

    def validate_session(self) -> bool | None:
        """Returns True if valid, False if invalid/stale, None if rate limited."""
        try:
            data = self._get("/api/v1/users/web_profile_info/", {"username": "instagram"},
                             referer="https://www.instagram.com/instagram/")
            return "data" in data and "user" in data["data"]
        except SessionExpiredError:
            logger.warning("Session validation failed: session expired")
            return False
        except HTTPError as e:
            if e.response is not None and e.response.status_code == 429:
                logger.warning("Session validation skipped: rate limited")
                return None
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
        data = self._get("/api/v1/users/web_profile_info/", {"username": username},
                         referer=f"https://www.instagram.com/{username}/")
        return data["data"]["user"]["id"]

    def get_following(self) -> list[dict]:
        result = []
        max_id = None
        while True:
            params = {"count": "100"}
            if max_id:
                params["max_id"] = max_id
            data = self._get(f"/api/v1/friendships/{self._ds_user_id}/following/", params,
                             referer=f"https://www.instagram.com/{self._ds_user_id}/following/")
            for u in data.get("users", []):
                result.append({"username": u["username"], "pk": u["pk"]})
            if not data.get("next_max_id"):
                break
            max_id = data["next_max_id"]
            self.random_delay(3.0, 8.0)
        return result

    def _extract_post(self, item: dict) -> dict:
        """Extract standardized post data from an Instagram feed item."""
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
        username = item.get("user", {}).get("username", "unknown")

        return {
            "id": str(item["pk"]),
            "username": username,
            "caption": (item.get("caption") or {}).get("text", ""),
            "timestamp": ts,
            "permalink": f"https://www.instagram.com/p/{item['code']}/",
            "post_type": "reel" if media_type == 2 and item.get("video_versions") else "post",
            "media": media_items,
        }

    def _extract_story(self, item: dict, username: str) -> dict:
        """Extract standardized story data from an Instagram story item."""
        is_video = bool(item.get("video_versions"))
        url = item["video_versions"][0]["url"] if is_video else item["image_versions2"]["candidates"][0]["url"]
        taken_at = item.get("taken_at", 0)
        ts = datetime.fromtimestamp(taken_at, tz=timezone.utc).isoformat() if taken_at else ""
        return {
            "id": str(item["pk"]),
            "username": username,
            "caption": "",
            "timestamp": ts,
            "permalink": f"https://www.instagram.com/stories/{username}/{item['pk']}/",
            "post_type": "story",
            "media": [{"type": "video" if is_video else "image", "url": url, "order": 0}],
        }

    def get_user_posts(self, username: str, amount: int = 20) -> list[dict]:
        posts = []
        max_id = None
        while len(posts) < amount:
            params = {"count": str(min(amount - len(posts), 12))}
            if max_id:
                params["max_id"] = max_id
            data = self._get(f"/api/v1/feed/user/{username}/username/", params,
                             referer=f"https://www.instagram.com/{username}/")

            for item in data.get("items", []):
                post = self._extract_post(item)
                post["username"] = username
                posts.append(post)

            if not data.get("next_max_id"):
                break
            max_id = data["next_max_id"]
            self.random_delay(3.0, 8.0)

        return posts[:amount]

    def get_user_stories(self, username: str) -> list[dict]:
        user_id = self._resolve_user_id(username)
        self.random_delay(0.5, 1.5)

        data = self._get("/api/v1/feed/reels_media/", {"reel_ids": user_id},
                         referer=f"https://www.instagram.com/stories/{username}/")
        reel = data.get("reels", {}).get(str(user_id), {})
        return [self._extract_story(s, username) for s in reel.get("items", [])]

    def get_timeline_feed(self, pages: int = 5) -> list[dict]:
        """Fetch the home timeline feed. Returns posts from followed accounts."""
        posts = []
        max_id = None
        for _ in range(pages):
            params = {}
            if max_id:
                params["max_id"] = max_id
            data = self._get("/api/v1/feed/timeline/", params,
                             referer="https://www.instagram.com/")

            # Handle both response formats
            items = data.get("feed_items", data.get("items", []))
            for entry in items:
                item = entry.get("media_or_ad", entry)
                if not item or not item.get("pk") or not item.get("code"):
                    continue
                posts.append(self._extract_post(item))

            if not data.get("more_available"):
                break
            max_id = data.get("next_max_id")
            if not max_id:
                break
            self.browse_pause()

        return posts

    def get_reels_tray(self) -> list[dict]:
        """Fetch all current stories from followed users via the reels tray."""
        data = self._get("/api/v1/feed/reels_tray/",
                         referer="https://www.instagram.com/")
        tray = data.get("tray", [])

        stories = []
        needs_fetch = []

        for reel in tray:
            user = reel.get("user", {})
            username = user.get("username", "unknown")
            user_id = str(user.get("pk", ""))
            if not user_id:
                continue

            items = reel.get("items", [])
            if items:
                for s in items:
                    stories.append(self._extract_story(s, username))
            else:
                needs_fetch.append((user_id, username))

        # Fetch stories not included in tray response
        for user_id, username in needs_fetch:
            self.random_delay(0.5, 1.5)
            try:
                reel_data = self._get("/api/v1/feed/reels_media/", {"reel_ids": user_id},
                                      referer="https://www.instagram.com/stories/")
                for s in reel_data.get("reels", {}).get(user_id, {}).get("items", []):
                    stories.append(self._extract_story(s, username))
            except Exception as e:
                logger.warning(f"Failed to fetch stories for {username}: {e}")

        return stories

    def get_pending_dm_count(self) -> int:
        """Check the inbox for pending/unseen DM threads. Returns the count."""
        try:
            data = self._get("/api/v1/direct_v2/inbox/", {"limit": "1"},
                             referer="https://www.instagram.com/direct/inbox/")
            inbox = data.get("inbox", {})
            return inbox.get("unseen_count", 0)
        except Exception as e:
            logger.warning(f"Failed to check DM inbox: {e}")
            return 0

    def get_user_profile_pic(self, username: str) -> str:
        data = self._get("/api/v1/users/web_profile_info/", {"username": username},
                         referer=f"https://www.instagram.com/{username}/")
        return data["data"]["user"].get("profile_pic_url", "")

    @staticmethod
    def random_delay(min_s: float = 1.0, max_s: float = 3.0):
        time.sleep(random.uniform(min_s, max_s))
