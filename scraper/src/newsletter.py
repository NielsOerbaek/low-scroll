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
    """Use Claude to determine if an email is a confirmation or newsletter content."""
    body_preview = (email.get("body_text") or "")[:500]
    prompt = (
        f"Analyze this email and determine if it is a subscription confirmation email "
        f"(asking the user to click a link to confirm their newsletter subscription) or a regular "
        f"newsletter/content email.\n\n"
        f"From: {email['from_address']}\n"
        f"Subject: {email['subject']}\n"
        f"Body preview: {body_preview}\n\n"
        f"Respond with EXACTLY one word: CONFIRMATION or NEWSLETTER"
    )

    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=10,
        messages=[{"role": "user", "content": prompt}],
    )

    answer = response.content[0].text.strip().upper()

    if "CONFIRMATION" in answer:
        logger.info(f"Email {email['id']} classified as CONFIRMATION: {email['subject']}")
        db.mark_email_as_confirmation(email["id"])
    else:
        logger.info(f"Email {email['id']} classified as NEWSLETTER: {email['subject']}")
        db.mark_email_processed(email["id"])


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

    prompt = (
        f"Extract the confirmation/verify URL from this email. This is a subscription "
        f"confirmation email. Find the URL that the user should click to confirm their subscription.\n\n"
        f"Subject: {email['subject']}\n"
        f"From: {email['from_address']}\n\n"
        f"HTML body (first 3000 chars):\n{body_html[:3000]}\n\n"
        f"Text body (first 1500 chars):\n{body_text[:1500]}\n\n"
        f"Respond with ONLY the full URL, nothing else. If you cannot find a confirmation URL, respond with NONE."
    )

    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=500,
        messages=[{"role": "user", "content": prompt}],
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
            model="claude-sonnet-4-20250514",
            max_tokens=50,
            messages=[{"role": "user", "content": (
                f"Did this newsletter subscription confirmation succeed? "
                f"Page content after clicking the confirm link:\n\n{page_text}\n\n"
                f"Respond with EXACTLY: SUCCESS, FAILED, or UNCLEAR"
            )}],
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
            digest_content = _structure_digest(client, summaries, digest_prompt)
            html = _build_digest_html(config, digest_content, len(emails), today)
            db.save_digest_html(run_id, html)
            _send_digest_email(config, db, user_id, html, len(emails))

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

    default_instruction = (
        "Summarize this newsletter email thoroughly. Include all notable stories, data points, "
        "and takeaways. Use bullet points and cover both main stories and smaller items. "
        "Use plain text, no markdown."
    )
    instruction = system_prompt.strip() if system_prompt.strip() else default_instruction

    for email in emails:
        body = email.get("body_text") or ""
        if not body and email.get("body_html"):
            soup = BeautifulSoup(email["body_html"], "lxml")
            body = soup.get_text(separator="\n", strip=True)

        body = body[:8000]

        prompt = (
            f"{instruction}\n\n"
            f"From: {email['from_address']}\n"
            f"Subject: {email['subject']}\n"
            f"Date: {email['received_at']}\n\n"
            f"Content:\n{body}\n\n"
            f"Provide a brief, informative summary."
        )

        try:
            response = client.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=300,
                messages=[{"role": "user", "content": prompt}],
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


def _structure_digest(client: Anthropic, summaries: list[dict], digest_prompt: str = "") -> str:
    """Use Claude to structure individual summaries into a themed digest. Returns HTML."""
    summaries_text = ""
    for s in summaries:
        summaries_text += (
            f"--- Newsletter: {s['subject']} ---\n"
            f"From: {s['from']}\n"
            f"Received: {s['received_at']}\n"
            f"Summary:\n{s['summary']}\n\n"
        )

    default_instruction = (
        "Structure this newsletter digest by grouping related stories and themes together. "
        "For each theme or story, reference which newsletter(s) it appeared in (by name/sender). "
        "If a story appears in multiple newsletters, combine the coverage. "
        "Put the most important or widely-covered stories first. "
        "Include smaller standalone items at the end."
    )
    instruction = digest_prompt.strip() if digest_prompt.strip() else default_instruction

    prompt = (
        f"{instruction}\n\n"
        f"Here are the individual newsletter summaries:\n\n"
        f"{summaries_text}\n\n"
        f"Output the digest as simple HTML suitable for embedding in an email. "
        f"Use only basic tags: <h3>, <p>, <ul>, <li>, <strong>, <em>, <br>. "
        f"Use inline styles sparingly (only font-size and color). "
        f"Do NOT include <html>, <head>, <body>, or <style> tags."
    )

    try:
        response = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=2000,
            messages=[{"role": "user", "content": prompt}],
        )
        return response.content[0].text.strip()
    except Exception as e:
        logger.error(f"Failed to structure digest: {e}")
        # Fallback: render summaries sequentially
        fallback = ""
        for s in summaries:
            fallback += f"<h3>{s['subject']}</h3>"
            fallback += f"<p style='font-size:11px;color:#8e8e8e;'>{s['from']} &middot; {s['received_at']}</p>"
            fallback += f"<p>{s['summary']}</p>"
        return fallback


def _build_digest_html(config: Config, digest_content: str,
                       email_count: int, digest_date: str) -> str:
    """Build HTML for the newsletter digest email using Jinja2."""
    import os
    from jinja2 import Environment, FileSystemLoader

    template_dir = os.path.join(os.path.dirname(__file__), "..", "templates")
    env = Environment(loader=FileSystemLoader(template_dir))
    template = env.get_template("newsletter_digest.html")

    return template.render(
        digest_content=digest_content,
        email_count=email_count,
        digest_date=digest_date,
        base_url=config.BASE_URL,
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
                       html: str, email_count: int):
    """Send the digest email via Resend."""
    import resend
    resend.api_key = config.RESEND_API_KEY

    recipients = _get_recipients(db, user_id)
    if not recipients:
        logger.warning(f"No email recipients configured for user {user_id}, skipping newsletter digest")
        return

    resend.Emails.send({
        "from": "newsletters@raakode.dk",
        "to": recipients,
        "subject": f"Newsletter digest: {email_count} email{'s' if email_count != 1 else ''} summarized",
        "html": html,
    })


def get_schedules(db: Database, user_id: int) -> list[dict]:
    """Load newsletter digest schedules from user_config."""
    try:
        schedules = json.loads(db.get_user_config(user_id, "newsletter_schedules") or "[]")
        return [s for s in schedules if s.get("enabled", True)]
    except (json.JSONDecodeError, TypeError):
        return []
