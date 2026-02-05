import time
import random
from instagrapi import Client
from instagrapi.exceptions import LoginRequired, ClientError


class InstagramClient:
    def __init__(self, cookies: dict[str, str]):
        self._cl = Client()
        self._cl.set_settings({"cookies": cookies})

    def validate_session(self) -> bool:
        try:
            self._cl.account_info()
            return True
        except Exception:
            return False

    def get_following(self) -> list[dict]:
        user = self._cl.account_info()
        following = self._cl.user_following(user.pk)
        return [
            {"username": u.username, "pk": pk}
            for pk, u in following.items()
        ]

    def get_user_posts(self, username: str, amount: int = 20) -> list[dict]:
        user_id = self._cl.user_id_from_username(username)
        medias = self._cl.user_medias(user_id, amount=amount)
        posts = []
        for m in medias:
            media_items = []
            if m.resources:  # Carousel
                for i, r in enumerate(m.resources):
                    media_items.append({
                        "type": "video" if r.video_url else "image",
                        "url": str(r.video_url or r.thumbnail_url),
                        "order": i,
                    })
            else:
                media_items.append({
                    "type": "video" if m.video_url else "image",
                    "url": str(m.video_url or m.thumbnail_url),
                    "order": 0,
                })
            posts.append({
                "id": str(m.pk),
                "caption": m.caption_text or "",
                "timestamp": str(m.taken_at),
                "permalink": f"https://www.instagram.com/p/{m.code}/",
                "post_type": "reel" if m.media_type == 2 and m.video_url else "post",
                "media": media_items,
            })
        return posts

    def get_user_stories(self, username: str) -> list[dict]:
        user_id = self._cl.user_id_from_username(username)
        stories = self._cl.user_stories(user_id)
        result = []
        for s in stories:
            result.append({
                "id": str(s.pk),
                "caption": "",
                "timestamp": str(s.taken_at),
                "permalink": f"https://www.instagram.com/stories/{username}/{s.pk}/",
                "post_type": "story",
                "media": [{
                    "type": "video" if s.video_url else "image",
                    "url": str(s.video_url or s.thumbnail_url),
                    "order": 0,
                }],
            })
        return result

    def get_user_profile_pic(self, username: str) -> str:
        user_id = self._cl.user_id_from_username(username)
        info = self._cl.user_info(user_id)
        return str(info.profile_pic_url)

    @staticmethod
    def random_delay(min_s: float = 1.0, max_s: float = 3.0):
        time.sleep(random.uniform(min_s, max_s))
