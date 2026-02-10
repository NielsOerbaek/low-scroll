import logging
import re
import time
import random
from datetime import datetime, timezone
from curl_cffi import requests
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

MBASIC_BASE = "https://mbasic.facebook.com"


class FacebookClient:
    def __init__(self, cookies: dict[str, str]):
        self._session = requests.Session(impersonate="chrome131")
        for name, value in cookies.items():
            self._session.cookies.set(name, value, domain=".facebook.com")
        self._session.headers.update({
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "none",
        })

    def _get(self, url: str) -> str:
        self.random_delay(5.0, 10.0)
        for attempt in range(3):
            resp = self._session.get(url)
            if resp.status_code == 429:
                wait = 60 * (attempt + 1) + random.uniform(0, 30)
                logger.warning(f"Rate limited (attempt {attempt + 1}/3), waiting {wait:.0f}s...")
                time.sleep(wait)
                continue
            if resp.status_code >= 500:
                wait = 10 * (attempt + 1) + random.uniform(0, 10)
                logger.warning(f"Server error {resp.status_code} (attempt {attempt + 1}/3), retrying in {wait:.0f}s...")
                time.sleep(wait)
                continue
            resp.raise_for_status()
            return resp.text
        resp.raise_for_status()
        return resp.text

    def validate_session(self) -> bool | None:
        try:
            self.random_delay(1.0, 3.0)
            resp = self._session.get(f"{MBASIC_BASE}/")
            if resp.status_code == 429:
                logger.warning("FB session validation skipped: rate limited")
                return None
            html = resp.text
            if "login" in resp.url or "login_form" in html:
                return False
            if "mbasic_logout_button" in html or "logout" in html.lower():
                return True
            return False
        except Exception as e:
            logger.warning(f"FB session validation failed: {e}")
            return False

    def get_group_posts(self, group_id: str, limit: int = 10) -> list[dict]:
        url = f"{MBASIC_BASE}/groups/{group_id}/"
        html = self._get(url)
        soup = BeautifulSoup(html, "lxml")
        posts = []

        story_container = soup.find("div", id="m_group_stories_container")
        if not story_container:
            story_container = soup.find("div", role="main") or soup.body

        if not story_container:
            logger.warning(f"Could not find post container for group {group_id}")
            return []

        post_divs = story_container.find_all("div", recursive=False)

        for div in post_divs:
            if len(posts) >= limit:
                break
            try:
                post = self._parse_post(div, group_id)
                if post:
                    posts.append(post)
            except Exception as e:
                logger.debug(f"Skipping unparseable div: {e}")
                continue

        return posts

    def _parse_post(self, div, group_id: str) -> dict | None:
        author_el = div.find("h3")
        if not author_el:
            author_el = div.find("strong")
        if not author_el:
            return None

        author_link = author_el.find("a")
        author_name = author_link.get_text(strip=True) if author_link else author_el.get_text(strip=True)
        if not author_name:
            return None

        content = ""
        content_div = div.find("div", class_=lambda c: c and "d" in c)
        if content_div:
            content = content_div.get_text(strip=True)
        else:
            paragraphs = div.find_all("p")
            content = "\n".join(p.get_text(strip=True) for p in paragraphs)

        timestamp = ""
        abbr = div.find("abbr", attrs={"data-utime": True})
        if abbr:
            utime = int(abbr["data-utime"])
            timestamp = datetime.fromtimestamp(utime, tz=timezone.utc).isoformat()

        post_id = None
        permalink = ""
        links = div.find_all("a", href=True)
        for link in links:
            href = link["href"]
            match = re.search(r"/groups/\d+/posts/(\d+)", href)
            if match:
                story_fbid = match.group(1)
                post_id = f"fb_{story_fbid}"
                permalink = f"https://www.facebook.com/groups/{group_id}/posts/{story_fbid}/"
                break

        if not post_id:
            return None

        comment_count = 0
        for link in links:
            text = link.get_text(strip=True)
            match = re.match(r"(\d+)\s+Comment", text)
            if match:
                comment_count = int(match.group(1))
                break

        return {
            "id": post_id,
            "author_name": author_name,
            "content": content,
            "timestamp": timestamp,
            "permalink": permalink,
            "comment_count": comment_count,
        }

    def get_post_comments(self, group_id: str, story_fbid: str, limit: int = 3) -> list[dict]:
        url = f"{MBASIC_BASE}/groups/{group_id}/posts/{story_fbid}/"
        html = self._get(url)
        soup = BeautifulSoup(html, "lxml")
        comments = []

        comment_sections = soup.find_all("div", id=re.compile(r"^[0-9]+$"))
        for i, section in enumerate(comment_sections[:limit]):
            try:
                author_el = section.find("a")
                author_name = author_el.get_text(strip=True) if author_el else "Unknown"
                content_parts = []
                for el in section.find_all(["div", "span"]):
                    text = el.get_text(strip=True)
                    if text and text != author_name:
                        content_parts.append(text)
                content = " ".join(content_parts[:2]) if content_parts else ""

                timestamp = ""
                abbr = section.find("abbr", attrs={"data-utime": True})
                if abbr:
                    utime = int(abbr["data-utime"])
                    timestamp = datetime.fromtimestamp(utime, tz=timezone.utc).isoformat()

                if content:
                    comments.append({
                        "author_name": author_name,
                        "content": content,
                        "timestamp": timestamp,
                        "order": i,
                    })
            except Exception:
                continue

        return comments

    def get_group_name(self, group_id: str) -> str:
        url = f"{MBASIC_BASE}/groups/{group_id}/"
        html = self._get(url)
        soup = BeautifulSoup(html, "lxml")
        title_tag = soup.find("title")
        if title_tag:
            return title_tag.get_text(strip=True)
        return f"Group {group_id}"

    @staticmethod
    def random_delay(min_s: float = 5.0, max_s: float = 10.0):
        time.sleep(random.uniform(min_s, max_s))
