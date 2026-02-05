import logging
from src.db import Database
from src.instagram import InstagramClient
from src.downloader import MediaDownloader

logger = logging.getLogger(__name__)


class Scraper:
    def __init__(self, db: Database, ig_client: InstagramClient, downloader: MediaDownloader):
        self.db = db
        self.ig = ig_client
        self.downloader = downloader

    def scrape_account(self, username: str) -> tuple[int, int]:
        new_posts = 0
        new_stories = 0

        posts = self.ig.get_user_posts(username, amount=20)
        for post in posts:
            was_new = self._process_post(post, username)
            if was_new:
                new_posts += 1

        stories = self.ig.get_user_stories(username)
        for story in stories:
            was_new = self._process_post(story, username)
            if was_new:
                new_stories += 1

        self.db.update_last_checked(username)
        return new_posts, new_stories

    def _process_post(self, post_data: dict, username: str) -> bool:
        post_id = post_data["id"]

        if self.db.get_post(post_id):
            return False

        for item in post_data.get("media", []):
            file_path, thumb_path = self.downloader.download_with_thumbnail(
                url=item["url"],
                username=username,
                post_id=post_id,
                order=item["order"],
            )
            item["file_path"] = file_path
            item["thumbnail_path"] = thumb_path

        self.db.insert_post(
            id=post_id,
            username=username,
            post_type=post_data["post_type"],
            caption=post_data["caption"],
            timestamp=post_data["timestamp"],
            permalink=post_data["permalink"],
        )

        for item in post_data.get("media", []):
            self.db.insert_media(
                post_id=post_id,
                media_type=item["type"],
                file_path=item.get("file_path", ""),
                thumbnail_path=item.get("thumbnail_path"),
                order=item["order"],
            )

        return True

    def scrape_all(self) -> tuple[int, int]:
        accounts = self.db.get_all_accounts()
        total_posts = 0
        total_stories = 0

        for account in accounts:
            username = account["username"]
            try:
                logger.info(f"Scraping {username}...")
                posts, stories = self.scrape_account(username)
                total_posts += posts
                total_stories += stories
                logger.info(f"  {username}: {posts} new posts, {stories} new stories")
                self.ig.random_delay()
            except Exception as e:
                logger.error(f"  Error scraping {username}: {e}")

        return total_posts, total_stories

    def sync_following(self):
        following = self.ig.get_following()
        for user in following:
            profile_pic_url = self.ig.get_user_profile_pic(user["username"])
            file_path = self.downloader.download(
                url=profile_pic_url,
                username=user["username"],
                post_id="_profile",
                order=0,
            )
            self.db.upsert_account(user["username"], file_path)
            self.ig.random_delay(0.5, 1.5)
