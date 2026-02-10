import logging
from src.db import Database
from src.instagram import InstagramClient
from src.downloader import MediaDownloader
from src.facebook import FacebookClient

logger = logging.getLogger(__name__)


class Scraper:
    def __init__(self, db: Database, ig_client: InstagramClient, downloader: MediaDownloader,
                 fb_client=None):
        self.db = db
        self.ig = ig_client
        self.downloader = downloader
        self.fb = fb_client

    def scrape_account(self, username: str, since_date: str | None = None) -> tuple[int, int]:
        new_posts = 0
        new_stories = 0

        amount = 500 if since_date else 20
        posts = self.ig.get_user_posts(username, amount=amount)
        for post in posts:
            if since_date and post["timestamp"] < since_date:
                break
            was_new = self._process_post(post, username)
            if was_new:
                new_posts += 1

        # Delay between posts and stories fetch to look more human
        self.ig.random_delay(5.0, 15.0)

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
            item["file_path"] = file_path or ""
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

    def scrape_all_backfill(self, since_date: str) -> tuple[int, int]:
        accounts = self.db.get_all_accounts()
        total_posts = 0
        total_stories = 0

        for account in accounts:
            username = account["username"]
            try:
                logger.info(f"Backfill scraping {username} since {since_date}...")
                posts, stories = self.scrape_account(username, since_date=since_date)
                total_posts += posts
                total_stories += stories
                logger.info(f"  {username}: {posts} new posts, {stories} new stories")
                self.ig.random_delay(15.0, 45.0)
            except Exception as e:
                logger.error(f"  Error scraping {username}: {e}")

        return total_posts, total_stories

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
                self.ig.random_delay(15.0, 45.0)
            except Exception as e:
                logger.error(f"  Error scraping {username}: {e}")

        return total_posts, total_stories

    def sync_following(self):
        following = self.ig.get_following()
        following_usernames = [user["username"] for user in following]
        for user in following:
            profile_pic_url = self.ig.get_user_profile_pic(user["username"])
            file_path = self.downloader.download(
                url=profile_pic_url,
                username=user["username"],
                post_id="_profile",
                order=0,
            )
            self.db.upsert_account(user["username"], file_path)
            self.ig.random_delay(3.0, 8.0)
        self.db.delete_accounts_not_in(following_usernames)

    def scrape_fb_group(self, group_id: str) -> int:
        if not self.fb:
            return 0
        posts = self.fb.get_group_posts(group_id)
        new_count = 0
        for post in posts:
            was_new = self.db.insert_fb_post(
                id=post["id"],
                group_id=group_id,
                author_name=post["author_name"],
                content=post["content"],
                timestamp=post["timestamp"],
                permalink=post["permalink"],
                comment_count=post["comment_count"],
            )
            if was_new and post["comment_count"] > 0:
                story_fbid = post["id"].removeprefix("fb_")
                try:
                    comments = self.fb.get_post_comments(group_id, story_fbid, limit=3)
                    for comment in comments:
                        self.db.insert_fb_comment(
                            post_id=post["id"],
                            author_name=comment["author_name"],
                            content=comment["content"],
                            timestamp=comment["timestamp"],
                            order=comment["order"],
                        )
                except Exception as e:
                    logger.warning(f"Failed to fetch comments for {post['id']}: {e}")
            if was_new:
                new_count += 1
        self.db.update_fb_group_last_checked(group_id)
        return new_count

    def scrape_all_fb_groups(self) -> int:
        if not self.fb:
            return 0
        groups = self.db.get_all_fb_groups()
        total = 0
        for group in groups:
            try:
                logger.info(f"Scraping FB group: {group['name']}...")
                count = self.scrape_fb_group(group["group_id"])
                total += count
                logger.info(f"  {group['name']}: {count} new posts")
                self.fb.random_delay(15.0, 45.0)
            except Exception as e:
                logger.error(f"  Error scraping FB group {group['name']}: {e}")
        return total
