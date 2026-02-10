import base64
import os
from collections import defaultdict
from jinja2 import Environment, FileSystemLoader
import resend


class DigestBuilder:
    def __init__(self, resend_api_key: str, base_url: str, media_path: str = "/data/media", from_email: str = "ig@raakode.dk"):
        self.base_url = base_url
        self.from_email = from_email
        self.media_path = media_path
        resend.api_key = resend_api_key

        template_dir = os.path.join(os.path.dirname(__file__), "..", "templates")
        self._env = Environment(loader=FileSystemLoader(template_dir))

    def _read_and_encode_image(self, rel_path: str) -> str | None:
        full_path = os.path.join(self.media_path, rel_path)
        if not os.path.exists(full_path):
            return None
        with open(full_path, "rb") as f:
            return base64.b64encode(f.read()).decode()

    def _get_logo_base64(self) -> str | None:
        logo_path = os.path.join(os.path.dirname(__file__), "..", "assets", "logo.png")
        if not os.path.exists(logo_path):
            return None
        with open(logo_path, "rb") as f:
            return base64.b64encode(f.read()).decode()

    def build_html(self, posts: list[dict], fb_posts: list[dict] | None = None) -> tuple[str, list[dict]]:
        grouped = defaultdict(list)
        post_count = 0
        story_count = 0
        for post in posts:
            grouped[post["username"]].append(post)
            if post.get("type") == "story":
                story_count += 1
            else:
                post_count += 1

        attachments = []

        # Logo attachment
        logo_b64 = self._get_logo_base64()
        if logo_b64:
            attachments.append({
                "filename": "logo.png",
                "content": logo_b64,
                "content_type": "image/png",
                "content_id": "logo",
            })

        # Thumbnail attachments
        thumb_idx = 0
        for username in sorted(grouped.keys()):
            for post in grouped[username]:
                media_list = post.get("media", [])
                if media_list and media_list[0].get("thumbnail_path"):
                    thumb_b64 = self._read_and_encode_image(media_list[0]["thumbnail_path"])
                    if thumb_b64:
                        cid = f"thumb_{thumb_idx}"
                        post["cid"] = cid
                        attachments.append({
                            "filename": f"{cid}.jpg",
                            "content": thumb_b64,
                            "content_type": "image/jpeg",
                            "content_id": cid,
                        })
                        thumb_idx += 1

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
        )
        return html, attachments

    def send(self, to_email: str, html: str, post_count: int, attachments: list[dict] | None = None):
        payload = {
            "from": self.from_email,
            "to": [to_email],
            "subject": f"low-scroll digest: {post_count} new item{'s' if post_count != 1 else ''}",
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
            "subject": "ig-sub: Instagram cookies expired",
            "html": html,
        })
