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
        logger.info(f"Confirmation click result: {resp.status_code} for email {email['id']}")
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
            summaries = _summarize_newsletters(client, emails, system_prompt)
            html = _build_digest_html(config, summaries, len(emails), today)
            digest_email = db.get_user_config(user_id, "newsletter_digest_email") or ""
            _send_digest_email(config, db, user_id, html, len(emails), digest_email_override=digest_email)

            email_ids = [e["id"] for e in emails]
            db.mark_emails_digested(email_ids, today)
            db.finish_newsletter_digest_run(run_id, "success", email_count=len(emails))
            logger.info(f"Newsletter digest sent for user {user_id}: {len(emails)} emails summarized")

        except Exception as e:
            logger.error(f"Newsletter digest failed for user {user_id}: {e}")
            db.finish_newsletter_digest_run(run_id, "error", error=str(e))

    finally:
        db.close()


def _summarize_newsletters(client: Anthropic, emails: list[dict], system_prompt: str = "") -> list[dict]:
    """Use Claude to summarize each newsletter email."""
    summaries = []

    default_instruction = (
        "Summarize this newsletter email concisely in 2-4 bullet points. "
        "Focus on the key information, news, or takeaways. Use plain text, no markdown."
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

        summaries.append({
            "from": email["from_address"],
            "subject": email["subject"],
            "summary": summary,
            "received_at": email["received_at"],
        })

    return summaries


def _build_digest_html(config: Config, summaries: list[dict],
                       email_count: int, digest_date: str) -> str:
    """Build HTML for the newsletter digest email using Jinja2."""
    import os
    from jinja2 import Environment, FileSystemLoader

    template_dir = os.path.join(os.path.dirname(__file__), "..", "templates")
    env = Environment(loader=FileSystemLoader(template_dir))
    template = env.get_template("newsletter_digest.html")

    return template.render(
        summaries=summaries,
        email_count=email_count,
        digest_date=digest_date,
        base_url=config.BASE_URL,
    )


def _send_digest_email(config: Config, db: Database, user_id: int,
                       html: str, email_count: int, digest_email_override: str = ""):
    """Send the digest email via Resend."""
    import resend
    resend.api_key = config.RESEND_API_KEY

    email_recipient = digest_email_override.strip() or db.get_user_config(user_id, "email_recipient")
    if not email_recipient:
        logger.warning(f"No email_recipient configured for user {user_id}, skipping newsletter digest")
        return

    resend.Emails.send({
        "from": "newsletters@raakode.dk",
        "to": [email_recipient],
        "subject": f"Newsletter digest: {email_count} email{'s' if email_count != 1 else ''} summarized",
        "html": html,
    })
