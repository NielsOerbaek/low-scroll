import os
from collections import defaultdict
from jinja2 import Environment, FileSystemLoader
import resend


class DigestBuilder:
    def __init__(self, resend_api_key: str, base_url: str, from_email: str = "digest@ig.raakode.dk"):
        self.base_url = base_url
        self.from_email = from_email
        resend.api_key = resend_api_key

        template_dir = os.path.join(os.path.dirname(__file__), "..", "templates")
        self._env = Environment(loader=FileSystemLoader(template_dir))

    def build_html(self, posts: list[dict]) -> str:
        grouped = defaultdict(list)
        for post in posts:
            grouped[post["username"]].append(post)

        template = self._env.get_template("digest.html")
        return template.render(
            grouped_posts=dict(grouped),
            post_count=len(posts),
            account_count=len(grouped),
            base_url=self.base_url,
        )

    def send(self, to_email: str, html: str, post_count: int):
        resend.Emails.send({
            "from": self.from_email,
            "to": [to_email],
            "subject": f"Instagram Digest: {post_count} new item{'s' if post_count != 1 else ''}",
            "html": html,
        })

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
