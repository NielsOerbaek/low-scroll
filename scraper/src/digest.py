import os
from collections import defaultdict
from jinja2 import Environment, FileSystemLoader
import resend


class DigestBuilder:
    def __init__(self, resend_api_key: str, base_url: str, media_path: str = "/data/media", from_email: str = "low-scroll <ig@raakode.dk>"):
        self.base_url = base_url
        self.from_email = from_email
        self.media_path = media_path
        resend.api_key = resend_api_key

        template_dir = os.path.join(os.path.dirname(__file__), "..", "templates")
        self._env = Environment(loader=FileSystemLoader(template_dir))

    def build_html(self, posts: list[dict], fb_posts: list[dict] | None = None, pending_dms: int = 0) -> tuple[str, list[dict]]:
        grouped = defaultdict(list)
        post_count = 0
        story_count = 0
        for post in posts:
            grouped[post["username"]].append(post)
            if post.get("type") == "story":
                story_count += 1
            else:
                post_count += 1

        # Set thumbnail URLs for each post
        for username in sorted(grouped.keys()):
            for post in grouped[username]:
                media_list = post.get("media", [])
                if media_list and media_list[0].get("thumbnail_path"):
                    post["thumbnail_url"] = f"{self.base_url}/api/media/{media_list[0]['thumbnail_path']}"

        account_list = sorted(grouped.keys())

        fb_grouped = {}
        fb_count = 0
        if fb_posts:
            for p in fb_posts:
                group_id = p.get("group_id", "unknown")
                fb_grouped.setdefault(group_id, []).append(p)
                fb_count += 1

        template = self._env.get_template("digest.html")
        html = template.render(
            grouped_posts={u: grouped[u] for u in account_list},
            post_count=post_count,
            story_count=story_count,
            account_count=len(grouped),
            account_list=account_list,
            base_url=self.base_url,
            fb_grouped=fb_grouped,
            fb_count=fb_count,
            pending_dms=pending_dms,
        )
        return html, []

    def send(self, to_email: str, html: str, post_count: int, attachments: list[dict] | None = None, pending_dms: int = 0):
        parts = []
        if post_count > 0:
            parts.append(f"{post_count} new item{'s' if post_count != 1 else ''}")
        if pending_dms > 0:
            parts.append(f"{pending_dms} unread DM{'s' if pending_dms != 1 else ''}")
        subject = f"low-scroll digest: {', '.join(parts)}" if parts else "low-scroll digest"
        payload = {
            "from": self.from_email,
            "to": [to_email],
            "subject": subject,
            "html": html,
        }
        if attachments:
            payload["attachments"] = attachments
        resend.Emails.send(payload)

    def send_stale_cookies_alert(self, to_email: str):
        html = f"""
        <h2>Instagram Cookies Expired</h2>
        <p>Your Instagram session cookies have expired. The scraper can't fetch new content until you update them.</p>
        <p><a href="{self.base_url}/settings">Update cookies &rarr;</a></p>
        """
        resend.Emails.send({
            "from": self.from_email,
            "to": [to_email],
            "subject": "low-scroll: Instagram cookies expired",
            "html": html,
        })
