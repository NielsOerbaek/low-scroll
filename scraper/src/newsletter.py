import json
import logging
from datetime import datetime, timezone

from bs4 import BeautifulSoup
from curl_cffi import requests

from anthropic import Anthropic

from src.config import Config
from src.db import Database

logger = logging.getLogger(__name__)


def classify_emails(user_id: int):
    """Classify unprocessed newsletter emails as confirmations or content."""
    config = Config()
    db = Database(config.DATABASE_PATH)
    db.initialize()

    try:
        unclassified = db.get_unclassified_emails(user_id)
        if not unclassified:
            return

        logger.info(f"Classifying {len(unclassified)} unprocessed newsletter emails for user {user_id}")
        client = Anthropic(api_key=config.ANTHROPIC_API_KEY)

        for email in unclassified:
            try:
                _classify_single_email(db, client, email)
            except Exception as e:
                logger.error(f"Failed to classify email {email['id']}: {e}")
    finally:
        db.close()


def _classify_single_email(db: Database, client: Anthropic, email: dict):
    """Use Claude to determine if an email is a confirmation, welcome/onboarding, or newsletter content."""
    body_preview = (email.get("body_text") or "")[:1000]

    response = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=10,
        system=(
            "You classify incoming emails into exactly one of three categories:\n"
            "- CONFIRMATION: asks the user to click a link to confirm/verify their newsletter subscription\n"
            "- WELCOME: a welcome or onboarding email with no real news content (e.g. 'Welcome to X', account setup, tips for new subscribers)\n"
            "- NEWSLETTER: a regular newsletter with actual news, stories, or content worth summarizing"
        ),
        messages=[{"role": "user", "content": (
            f"From: {email['from_address']}\n"
            f"Subject: {email['subject']}\n"
            f"Body preview: {body_preview}\n\n"
            f"Respond with EXACTLY one word: CONFIRMATION, WELCOME, or NEWSLETTER"
        )}],
    )

    answer = response.content[0].text.strip().upper()

    if "CONFIRMATION" in answer:
        logger.info(f"Email {email['id']} classified as CONFIRMATION: {email['subject']}")
        db.mark_email_as_confirmation(email["id"])
    elif "WELCOME" in answer:
        logger.info(f"Email {email['id']} classified as WELCOME (skipped): {email['subject']}")
        db.mark_email_as_confirmation(email["id"])  # Treat like confirmation — processed but not digested
    else:
        logger.info(f"Email {email['id']} classified as NEWSLETTER: {email['subject']}")
        db.mark_email_processed(email["id"])


def summarize_new_emails(user_id: int):
    """Summarize processed newsletter emails that don't have a summary yet."""
    config = Config()
    db = Database(config.DATABASE_PATH)
    db.initialize()

    try:
        unsummarized = db.get_unsummarized_emails(user_id)
        if not unsummarized:
            return

        logger.info(f"Summarizing {len(unsummarized)} newsletter emails for user {user_id}")
        client = Anthropic(api_key=config.ANTHROPIC_API_KEY)
        system_prompt = db.get_user_config(user_id, "newsletter_system_prompt") or ""
        _summarize_newsletters(client, unsummarized, system_prompt, db=db)
    finally:
        db.close()


def click_confirmations(user_id: int):
    """Find confirmation emails and click the confirmation links."""
    config = Config()
    db = Database(config.DATABASE_PATH)
    db.initialize()

    try:
        confirmations = db.get_unprocessed_confirmations(user_id)
        if not confirmations:
            return

        logger.info(f"Processing {len(confirmations)} confirmation emails for user {user_id}")
        client = Anthropic(api_key=config.ANTHROPIC_API_KEY)

        for email in confirmations:
            try:
                _click_confirmation(db, client, email)
            except Exception as e:
                logger.error(f"Failed to click confirmation for email {email['id']}: {e}")
    finally:
        db.close()


def _click_confirmation(db: Database, client: Anthropic, email: dict):
    """Extract confirmation link from email and click it."""
    body_html = email.get("body_html") or ""
    body_text = email.get("body_text") or ""

    response = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=500,
        system="Extract the confirmation/verify URL from subscription confirmation emails. Respond with ONLY the full URL, nothing else. If no confirmation URL exists, respond with NONE.",
        messages=[{"role": "user", "content": (
            f"Subject: {email['subject']}\n"
            f"From: {email['from_address']}\n\n"
            f"HTML body (first 3000 chars):\n{body_html[:3000]}\n\n"
            f"Text body (first 1500 chars):\n{body_text[:1500]}"
        )}],
    )

    url = response.content[0].text.strip()

    if url == "NONE" or not url.startswith("http"):
        logger.warning(f"No confirmation URL found in email {email['id']}")
        db.mark_confirmation_clicked(email["id"])
        return

    logger.info(f"Clicking confirmation link for email {email['id']}: {url[:80]}...")

    session = requests.Session(impersonate="chrome131")
    try:
        resp = session.get(url, timeout=30, allow_redirects=True)
        logger.info(f"Confirmation click HTTP {resp.status_code} for email {email['id']}")

        # Ask Claude to verify the response page
        page_text = BeautifulSoup(resp.text[:5000], "lxml").get_text(separator=" ", strip=True)[:2000]
        verify = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=50,
            system="You verify whether a newsletter subscription confirmation succeeded by reading the resulting page. Respond with EXACTLY one word: SUCCESS, FAILED, or UNCLEAR.",
            messages=[{"role": "user", "content": f"Page content after clicking the confirm link:\n\n{page_text}"}],
        )
        result = verify.content[0].text.strip().upper()
        if "SUCCESS" in result:
            logger.info(f"Confirmation VERIFIED for email {email['id']}: {email['from_address']}")
        elif "FAILED" in result:
            logger.warning(f"Confirmation FAILED for email {email['id']}: {email['from_address']} — page did not confirm success")
        else:
            logger.warning(f"Confirmation UNCLEAR for email {email['id']}: {email['from_address']}")
    except Exception as e:
        logger.error(f"Failed to click confirmation link for email {email['id']}: {e}")
    finally:
        db.mark_confirmation_clicked(email["id"])


def build_and_send_digest(user_id: int):
    """Build a newsletter digest from undigested emails and send it."""
    config = Config()
    db = Database(config.DATABASE_PATH)
    db.initialize()

    try:
        emails = db.get_undigested_emails(user_id)
        if not emails:
            logger.info(f"No undigested newsletter emails for user {user_id}")
            return

        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        run_id = db.insert_newsletter_digest_run(user_id, today)

        logger.info(f"Building newsletter digest for user {user_id}: {len(emails)} emails")

        try:
            client = Anthropic(api_key=config.ANTHROPIC_API_KEY)
            system_prompt = db.get_user_config(user_id, "newsletter_system_prompt") or ""
            digest_prompt = db.get_user_config(user_id, "newsletter_digest_prompt") or ""
            summaries = _summarize_newsletters(client, emails, system_prompt, db=db)
            recent_digests = db.get_recent_digest_html(user_id, limit=3)
            digest_title, digest_content = _structure_digest(client, summaries, digest_prompt, recent_digests)
            html = _build_digest_html(config, digest_content, len(emails), today, emails=emails)
            db.save_digest_html(run_id, html)
            _send_digest_email(config, db, user_id, html, emails, digest_title)

            email_ids = [e["id"] for e in emails]
            db.mark_emails_digested(email_ids, today)
            db.finish_newsletter_digest_run(run_id, "success", email_count=len(emails))
            logger.info(f"Newsletter digest sent for user {user_id}: {len(emails)} emails summarized")

        except Exception as e:
            logger.error(f"Newsletter digest failed for user {user_id}: {e}")
            db.finish_newsletter_digest_run(run_id, "error", error=str(e))

    finally:
        db.close()


def _summarize_newsletters(client: Anthropic, emails: list[dict], system_prompt: str = "", db: Database = None) -> list[dict]:
    """Use Claude to summarize each newsletter email."""
    summaries = []

    default_system = (
        "You summarize newsletter emails. Cover all notable stories, data points, and takeaways. "
        "Use bullet points for multiple stories. Include both main stories and smaller items. "
        "Use plain text, no markdown. Be thorough but concise."
    )
    system = system_prompt.strip() if system_prompt.strip() else default_system

    for email in emails:
        body = email.get("body_text") or ""
        if not body and email.get("body_html"):
            soup = BeautifulSoup(email["body_html"], "lxml")
            body = soup.get_text(separator="\n", strip=True)

        body = body[:8000]

        try:
            response = client.messages.create(
                model="claude-opus-4-6",
                max_tokens=600,
                system=system,
                messages=[{"role": "user", "content": (
                    f"From: {email['from_address']}\n"
                    f"Subject: {email['subject']}\n"
                    f"Date: {email['received_at']}\n\n"
                    f"Content:\n{body}"
                )}],
            )
            summary = response.content[0].text.strip()
        except Exception as e:
            logger.error(f"Failed to summarize email {email['id']}: {e}")
            summary = f"(Summary unavailable: {email['subject']})"

        if db:
            try:
                db.save_email_summary(email["id"], summary)
            except Exception as e:
                logger.error(f"Failed to save summary for email {email['id']}: {e}")

        summaries.append({
            "from": email["from_address"],
            "subject": email["subject"],
            "summary": summary,
            "received_at": email["received_at"],
        })

    return summaries


def _structure_digest(client: Anthropic, summaries: list[dict], digest_prompt: str = "",
                      recent_digests: list[dict] | None = None) -> tuple[str, str]:
    """Use Claude to structure individual summaries into a themed digest. Returns (title, HTML)."""
    summaries_text = ""
    for s in summaries:
        summaries_text += (
            f"--- Newsletter: {s['subject']} ---\n"
            f"From: {s['from']}\n"
            f"Received: {s['received_at']}\n"
            f"Summary:\n{s['summary']}\n\n"
        )

    default_system = (
        "You are writing a daily briefing newsletter. Your output should read like a polished, "
        "well-structured newsletter — not a list of summaries.\n\n"
        "Structure:\n"
        "1. Start with a short bullet-point overview listing each story covered. "
        "For each bullet, mention which newsletter(s) covered it in parentheses.\n"
        "2. After the bullet list, state how many newsletters this digest covers.\n"
        "3. Then write the full briefing as flowing prose organized by theme. Group related stories, "
        "combine overlapping coverage from different sources, and reference which newsletter(s) "
        "reported each story. Put the most important stories first.\n"
        "4. The tone should be informative and concise — like a morning briefing for a busy reader.\n"
        "5. If a story relates to something covered in a previous digest, briefly note the connection "
        "(e.g. 'following up on...', 'as previously reported...').\n\n"
        "Output format:\n"
        "Wrap the email subject line in <title>...</title> tags.\n"
        "Then write the digest as simple HTML suitable for embedding in an email. "
        "Use only basic tags: <h3>, <p>, <ul>, <li>, <strong>, <em>, <br>. "
        "Use inline styles sparingly (only font-size and color). "
        "Do NOT include <html>, <head>, <body>, or <style> tags."
    )
    system = digest_prompt.strip() if digest_prompt.strip() else default_system

    # Build context from recent digests
    context = ""
    if recent_digests:
        context = "=== PREVIOUS DIGESTS (for context, to reference ongoing stories) ===\n\n"
        for d in reversed(recent_digests):  # oldest first
            # Extract text content from HTML to keep context lean
            digest_text = BeautifulSoup(d["digest_html"] or "", "lxml").get_text(separator="\n", strip=True)
            # Truncate each digest to keep context manageable
            context += f"--- Digest from {d['digest_date']} ---\n{digest_text[:2000]}\n\n"
        context += "=== TODAY'S NEWSLETTERS ===\n\n"

    try:
        response = client.messages.create(
            model="claude-opus-4-6",
            max_tokens=4000,
            system=system,
            messages=[{"role": "user", "content": context + summaries_text}],
        )
        text = response.content[0].text.strip()
        # Extract title from <title>...</title> tags
        import re
        title_match = re.search(r'<title>(.*?)</title>', text, re.DOTALL)
        title = title_match.group(1).strip() if title_match else None
        if title_match:
            text = text[:title_match.start()] + text[title_match.end():]
            text = text.strip()
        return title or "Newsletter Digest", text
    except Exception as e:
        logger.error(f"Failed to structure digest: {e}")
        fallback = ""
        for s in summaries:
            fallback += f"<h3>{s['subject']}</h3>"
            fallback += f"<p style='font-size:11px;color:#8e8e8e;'>{s['from']} &middot; {s['received_at']}</p>"
            fallback += f"<p>{s['summary']}</p>"
        return "Newsletter Digest", fallback


def _clean_sender(from_address: str, fallback: str = "") -> str:
    """Extract a readable newsletter name from a bounce email address."""
    import re as _re
    domain = from_address.rsplit("@", 1)[-1] if "@" in from_address else from_address
    generic = {"ghost.io", "substack.com", "mcsv.net", "mcdlv.net", "mailchimp.com"}
    if any(domain == g or domain.endswith("." + g) for g in generic):
        return fallback or domain
    clean = _re.sub(r'^(ghost|notify|bounces?|mg-?\w*|m|em\d*\.mail|mail\d*\.suw\d*)\.', '', domain, flags=_re.IGNORECASE)
    name = clean.split(".")[0]
    return name[0].upper() + name[1:] if name else domain


def _build_digest_html(config: Config, digest_content: str,
                       email_count: int, digest_date: str,
                       emails: list[dict] | None = None) -> str:
    """Build HTML for the newsletter digest email using Jinja2."""
    import os
    from jinja2 import Environment, FileSystemLoader

    template_dir = os.path.join(os.path.dirname(__file__), "..", "templates")
    env = Environment(loader=FileSystemLoader(template_dir))
    env.filters["clean_sender"] = lambda addr, fb="": _clean_sender(addr, fb)
    template = env.get_template("newsletter_digest.html")

    return template.render(
        digest_content=digest_content,
        email_count=email_count,
        digest_date=digest_date,
        base_url=config.BASE_URL,
        emails=emails or [],
    )


def _get_recipients(db: Database, user_id: int) -> list[str]:
    """Resolve recipient list from user_config with fallback chain."""
    try:
        recipients = json.loads(db.get_user_config(user_id, "newsletter_recipients") or "[]")
        if recipients:
            return recipients
    except (json.JSONDecodeError, TypeError):
        pass
    # Fallback: old single-email key
    old = db.get_user_config(user_id, "newsletter_digest_email") or ""
    if old:
        return [old]
    # Fallback: main email_recipient
    main = db.get_user_config(user_id, "email_recipient") or ""
    return [main] if main else []


def _send_digest_email(config: Config, db: Database, user_id: int,
                       html: str, emails: list[dict], subject: str = "Newsletter Digest"):
    """Send the digest email via Resend with links to original newsletters."""
    import resend
    resend.api_key = config.RESEND_API_KEY

    recipients = _get_recipients(db, user_id)
    if not recipients:
        logger.warning(f"No email recipients configured for user {user_id}, skipping newsletter digest")
        return

    resend.Emails.send({
        "from": "FøhnsStiftstidende <newsletters@raakode.dk>",
        "to": recipients,
        "subject": subject,
        "html": html,
    })


def get_schedules(db: Database, user_id: int) -> list[dict]:
    """Load newsletter digest schedules from user_config."""
    try:
        schedules = json.loads(db.get_user_config(user_id, "newsletter_schedules") or "[]")
        return [s for s in schedules if s.get("enabled", True)]
    except (json.JSONDecodeError, TypeError):
        return []
