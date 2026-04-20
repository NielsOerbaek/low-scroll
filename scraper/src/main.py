import logging
import signal
import sys
import time
from datetime import datetime, timezone

from croniter import croniter

from src.config import Config
from src.db import Database
from src.cookies import CookieManager
from src.instagram import InstagramClient, SessionExpiredError
from src.downloader import MediaDownloader
from src.scrape import Scraper
from src.digest import DigestBuilder
from src.newsletter import classify_emails, click_confirmations, summarize_new_emails, build_and_send_digest, get_schedules

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


class DbLogHandler(logging.Handler):
    """Logging handler that appends log lines to a database log column."""
    def __init__(self, log_fn):
        super().__init__()
        self._log_fn = log_fn
        self.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))

    def emit(self, record):
        try:
            self._log_fn(self.format(record))
        except Exception:
            pass


def is_scrape_due(cron_expr: str, last_scrape_time: str | None) -> bool:
    """Check if a scrape is due based on cron expression and last scrape time."""
    if last_scrape_time is None:
        return True  # Never scraped, always due
    last = datetime.fromisoformat(last_scrape_time)
    if last.tzinfo is None:
        last = last.replace(tzinfo=timezone.utc)
    now = datetime.now(timezone.utc)
    cron = croniter(cron_expr, last)
    next_run = cron.get_next(datetime)
    return now >= next_run


def run_user_scrape(user_id: int):
    """Run a full scrape for a specific user."""
    logger.info(f"Starting scrape for user {user_id}...")
    config = Config()
    db = Database(config.DATABASE_PATH)
    db.initialize()

    run_id = db.insert_scrape_run(user_id)

    # Attach DB log handler to capture all logs for this run
    db_handler = DbLogHandler(lambda line: db.append_scrape_run_log(run_id, line))
    root_logger = logging.getLogger()
    root_logger.addHandler(db_handler)

    try:
        cookie_mgr = CookieManager(db, config.ENCRYPTION_KEY)
        cookies = cookie_mgr.get_cookies(user_id)

        digest = DigestBuilder(
            resend_api_key=config.RESEND_API_KEY,
            base_url=config.BASE_URL,
            media_path=config.MEDIA_PATH,
        )

        if not cookies:
            logger.warning(f"No cookies configured for user {user_id}. Skipping.")
            db.finish_scrape_run(run_id, "error", error="No cookies configured")
            return

        ig = InstagramClient(cookies)
        downloader = MediaDownloader(config.MEDIA_PATH)
        scraper = Scraper(db=db, ig_client=ig, downloader=downloader, user_id=user_id)

        total_posts, total_stories = scraper.scrape_all()
        db.finish_scrape_run(run_id, "success", total_posts, total_stories)
        logger.info(f"Scrape complete for user {user_id}: {total_posts} posts, {total_stories} stories")

        # Check for pending DMs
        pending_dms = ig.get_pending_dm_count()
        if pending_dms > 0:
            logger.info(f"Pending DMs for user {user_id}: {pending_dms}")

        # --- Facebook scraping ---
        new_fb_posts = 0
        fb_cookies = cookie_mgr.get_fb_cookies(user_id)
        if fb_cookies:
            from src.facebook import FacebookClient
            fb = FacebookClient(fb_cookies)
            fb_session_ok = fb.validate_session()
            if fb_session_ok is None:
                logger.warning(f"FB rate limited during validation for user {user_id}, skipping FB this run.")
            elif not fb_session_ok:
                logger.warning(f"FB cookies are stale for user {user_id}!")
                cookie_mgr.mark_fb_stale(user_id)
            else:
                scraper.fb = fb
                new_fb_posts = scraper.scrape_all_fb_groups()
                logger.info(f"FB scrape complete for user {user_id}: {new_fb_posts} new posts")
        else:
            logger.info(f"No FB cookies for user {user_id}, skipping Facebook scraping.")

        # Send per-user digest email (skipped when IG digest is handled by Oneshot)
        total_new = total_posts + total_stories + new_fb_posts
        email_recipient = db.get_user_config(user_id, "email_recipient")
        if config.IG_DIGEST_MODE == "oneshot":
            logger.info(f"IG_DIGEST_MODE=oneshot, skipping inline digest email for user {user_id}")
        elif email_recipient and (total_new > 0 or pending_dms > 0):
            run_info = db.get_scrape_run(run_id)
            new_posts = db.get_new_posts_since(user_id, run_info["started_at"])
            for post in new_posts:
                post["media"] = db.get_media_for_post(post["id"])
            new_fb = db.get_new_fb_posts_since(user_id, run_info["started_at"])
            html, attachments = digest.build_html(new_posts, new_fb, pending_dms=pending_dms)
            digest.send(email_recipient, html, total_new, attachments=attachments, pending_dms=pending_dms)
            logger.info(f"Digest email sent for user {user_id}.")

    except SessionExpiredError:
        logger.warning(f"Session expired during scrape for user {user_id} — cookies need refresh")
        cookie_mgr.mark_stale(user_id)
        db.finish_scrape_run(run_id, "error", error="Session expired — update cookies")
        email_recipient = db.get_user_config(user_id, "email_recipient")
        if email_recipient:
            try:
                digest.send_stale_cookies_alert(email_recipient)
            except Exception as e:
                logger.error(f"Failed to send stale cookies alert for user {user_id}: {e}")
    except Exception as e:
        logger.error(f"Scrape failed for user {user_id}: {e}")
        db.finish_scrape_run(run_id, "error", error=str(e))
    finally:
        root_logger.removeHandler(db_handler)
        db.close()


def check_due_scrapes():
    """Check all active users and run scrapes for those whose cron schedule is due."""
    config = Config()
    db = Database(config.DATABASE_PATH)
    db.initialize()

    try:
        users = db.get_all_active_users()
        for user in users:
            user_id = user["id"]
            cron_schedule = db.get_user_config(user_id, "cron_schedule") or "0 8 * * *"
            last_scrape = db.get_last_scrape_time(user_id)

            if is_scrape_due(cron_schedule, last_scrape):
                logger.info(f"Scrape due for user {user_id} (cron={cron_schedule}, last={last_scrape})")
                db.close()
                run_user_scrape(user_id)
                # Re-open db for next user
                db._conn = None
                db.initialize()
    finally:
        db.close()


def check_user_cookie_tests():
    """Check all active users for pending IG or FB cookie tests."""
    config = Config()
    db = Database(config.DATABASE_PATH)
    db.initialize()

    try:
        users = db.get_all_active_users()
        for user in users:
            user_id = user["id"]

            # IG cookie test
            status = db.get_user_config(user_id, "cookie_test")
            if status == "pending":
                _run_ig_cookie_test(user_id, config, db)

            # FB cookie test
            fb_status = db.get_user_config(user_id, "fb_cookie_test")
            if fb_status == "pending":
                _run_fb_cookie_test(user_id, config, db)
    finally:
        db.close()


def _run_ig_cookie_test(user_id: int, config: Config, db: Database):
    """Run an Instagram cookie test for a specific user."""
    logger.info(f"Cookie test requested for user {user_id}, validating session...")
    db.set_user_config(user_id, "cookie_test", "running")
    log_lines = []

    def log(msg):
        log_lines.append(msg)
        db.set_user_config(user_id, "cookie_test_log", "\n".join(log_lines))
        logger.info(f"[cookie_test user={user_id}] {msg}")

    log("Loading cookies from database...")
    cookie_mgr = CookieManager(db, config.ENCRYPTION_KEY)
    cookies = cookie_mgr.get_cookies(user_id)

    if not cookies:
        log("ERROR: No cookies configured.")
        db.set_user_config(user_id, "cookie_test", "error:No cookies configured")
        return

    has_session = bool(cookies.get("sessionid"))
    has_csrf = bool(cookies.get("csrftoken"))
    has_dsuid = bool(cookies.get("ds_user_id"))
    log(f"Found cookies: sessionid={'yes' if has_session else 'MISSING'}, "
        f"csrftoken={'yes' if has_csrf else 'MISSING'}, "
        f"ds_user_id={cookies.get('ds_user_id', 'MISSING')}")

    if not has_session:
        log("ERROR: sessionid cookie is required.")
        db.set_user_config(user_id, "cookie_test", "error:sessionid cookie missing")
        return

    log("Creating Instagram client...")
    ig = InstagramClient(cookies)

    log("Testing session against Instagram API (GET /api/v1/feed/reels_tray/) ...")
    log("(This may take a few minutes if rate-limited)")

    # Capture instagram module logs (rate limit warnings etc.)
    class CookieTestLogHandler(logging.Handler):
        def __init__(self):
            super().__init__()
            self.setFormatter(logging.Formatter("%(message)s"))

        def emit(self, record):
            try:
                log(self.format(record))
            except Exception:
                pass

    ig_logger = logging.getLogger("src.instagram")
    handler = CookieTestLogHandler()
    ig_logger.addHandler(handler)
    try:
        session_ok = ig.validate_session()
    finally:
        ig_logger.removeHandler(handler)

    if session_ok is None:
        log("RESULT: Rate limited by Instagram. Try again in 10-15 minutes.")
        db.set_user_config(user_id, "cookie_test", "error:Rate limited, try again later")
    elif session_ok:
        log("Session is valid! Fetching username...")
        username = ig.get_logged_in_username()
        log(f"RESULT: Cookies valid — logged in as @{username}")
        db.set_user_config(user_id, "cookie_test", f"valid:{username}")
    else:
        log("RESULT: Cookies are stale or invalid. Re-sync from browser.")
        db.set_user_config(user_id, "cookie_test", "error:Cookies are stale or invalid")


def _run_fb_cookie_test(user_id: int, config: Config, db: Database):
    """Run a Facebook cookie test for a specific user."""
    logger.info(f"FB cookie test requested for user {user_id}, validating session...")
    db.set_user_config(user_id, "fb_cookie_test", "running")
    log_lines = []

    def log(msg):
        log_lines.append(msg)
        db.set_user_config(user_id, "fb_cookie_test_log", "\n".join(log_lines))
        logger.info(f"[fb_cookie_test user={user_id}] {msg}")

    log("Loading FB cookies from database...")
    cookie_mgr = CookieManager(db, config.ENCRYPTION_KEY)
    cookies = cookie_mgr.get_fb_cookies(user_id)

    if not cookies:
        log("ERROR: No FB cookies configured.")
        db.set_user_config(user_id, "fb_cookie_test", "error:No FB cookies configured")
        return

    has_c_user = bool(cookies.get("c_user"))
    has_xs = bool(cookies.get("xs"))
    log(f"Found cookies: c_user={'yes' if has_c_user else 'MISSING'}, xs={'yes' if has_xs else 'MISSING'}")

    if not has_c_user or not has_xs:
        log("ERROR: c_user and xs cookies are required.")
        db.set_user_config(user_id, "fb_cookie_test", "error:Required cookies missing (c_user, xs)")
        return

    log("Creating Facebook client...")
    from src.facebook import FacebookClient
    fb = FacebookClient(cookies)

    log("Testing session against mbasic.facebook.com ...")

    try:
        session_ok = fb.validate_session()
    except Exception as e:
        log(f"ERROR: {e}")
        db.set_user_config(user_id, "fb_cookie_test", f"error:{e}")
        return

    if session_ok is None:
        log("RESULT: Rate limited by Facebook. Try again later.")
        db.set_user_config(user_id, "fb_cookie_test", "error:Rate limited, try again later")
    elif session_ok:
        log(f"RESULT: FB cookies valid — logged in as user {cookies.get('c_user', 'unknown')}")
        db.set_user_config(user_id, "fb_cookie_test", f"valid:{cookies.get('c_user', 'unknown')}")
    else:
        log("RESULT: FB cookies are stale or invalid. Re-sync from browser.")
        db.set_user_config(user_id, "fb_cookie_test", "error:FB cookies are stale or invalid")


def check_user_manual_runs():
    """Check all active users for pending manual runs."""
    config = Config()
    db = Database(config.DATABASE_PATH)
    db.initialize()

    try:
        users = db.get_all_active_users()
        for user in users:
            user_id = user["id"]
            run = db.get_pending_manual_run(user_id)
            if not run:
                continue

            run_id = run["id"]
            since_date = run["since_date"]
            logger.info(f"Starting manual run #{run_id} for user {user_id} (since {since_date})...")
            db.start_manual_run(run_id)

            # Attach DB log handler for this run
            db_handler = DbLogHandler(lambda line, rid=run_id: db.append_manual_run_log(rid, line))
            root_logger = logging.getLogger()
            root_logger.addHandler(db_handler)

            try:
                cookie_mgr = CookieManager(db, config.ENCRYPTION_KEY)
                cookies = cookie_mgr.get_cookies(user_id)

                if not cookies:
                    logger.warning(f"No cookies for manual run #{run_id}, user {user_id}.")
                    db.finish_manual_run(run_id, "error", error="No cookies configured")
                    continue

                ig = InstagramClient(cookies)
                downloader = MediaDownloader(config.MEDIA_PATH)
                scraper = Scraper(db=db, ig_client=ig, downloader=downloader, user_id=user_id)

                total_posts, total_stories = scraper.scrape_all_backfill(since_date)
                db.finish_manual_run(run_id, "success", total_posts, total_stories)
                logger.info(f"Manual run #{run_id} complete for user {user_id}: {total_posts} posts, {total_stories} stories")
            except SessionExpiredError:
                logger.warning(f"Session expired during manual run #{run_id} for user {user_id}")
                cookie_mgr.mark_stale(user_id)
                db.finish_manual_run(run_id, "error", error="Session expired — update cookies")
            except Exception as e:
                logger.error(f"Manual run #{run_id} failed for user {user_id}: {e}")
                db.finish_manual_run(run_id, "error", error=str(e))
            finally:
                root_logger.removeHandler(db_handler)
    finally:
        db.close()


def check_user_triggers():
    """Check all active users for pending triggered scrapes (IG, FB, or full)."""
    config = Config()
    db = Database(config.DATABASE_PATH)
    db.initialize()

    try:
        users = db.get_all_active_users()
        for user in users:
            user_id = user["id"]

            # Full scrape trigger
            trigger = db.get_user_config(user_id, "trigger_scrape")
            if trigger == "pending":
                logger.info(f"Manual scrape trigger for user {user_id}...")
                db.set_user_config(user_id, "trigger_scrape", "running")
                db.close()
                run_user_scrape(user_id)
                db._conn = None
                db.initialize()
                db.set_user_config(user_id, "trigger_scrape", "done")

            # IG-only trigger
            ig_trigger = db.get_user_config(user_id, "trigger_ig_scrape")
            if ig_trigger == "pending":
                logger.info(f"Manual IG scrape trigger for user {user_id}...")
                db.set_user_config(user_id, "trigger_ig_scrape", "running")
                db.close()
                _run_ig_only_scrape(user_id)
                db._conn = None
                db.initialize()
                db.set_user_config(user_id, "trigger_ig_scrape", "done")

            # FB-only trigger
            fb_trigger = db.get_user_config(user_id, "trigger_fb_scrape")
            if fb_trigger == "pending":
                logger.info(f"Manual FB scrape trigger for user {user_id}...")
                db.set_user_config(user_id, "trigger_fb_scrape", "running")
                db.close()
                _run_fb_only_scrape(user_id)
                db._conn = None
                db.initialize()
                db.set_user_config(user_id, "trigger_fb_scrape", "done")
    finally:
        db.close()


def _run_ig_only_scrape(user_id: int):
    """Run only the Instagram scrape portion for a specific user."""
    logger.info(f"Starting IG-only scrape for user {user_id}...")
    config = Config()
    db = Database(config.DATABASE_PATH)
    db.initialize()

    run_id = db.insert_scrape_run(user_id)
    db_handler = DbLogHandler(lambda line: db.append_scrape_run_log(run_id, line))
    root_logger = logging.getLogger()
    root_logger.addHandler(db_handler)

    try:
        cookie_mgr = CookieManager(db, config.ENCRYPTION_KEY)
        cookies = cookie_mgr.get_cookies(user_id)
        digest = DigestBuilder(
            resend_api_key=config.RESEND_API_KEY,
            base_url=config.BASE_URL,
            media_path=config.MEDIA_PATH,
        )

        if not cookies:
            logger.warning(f"No IG cookies for user {user_id}. Skipping.")
            db.finish_scrape_run(run_id, "error", error="No IG cookies configured")
            return

        ig = InstagramClient(cookies)
        downloader = MediaDownloader(config.MEDIA_PATH)
        scraper = Scraper(db=db, ig_client=ig, downloader=downloader, user_id=user_id)

        total_posts, total_stories = scraper.scrape_all()
        db.finish_scrape_run(run_id, "success", total_posts, total_stories)
        logger.info(f"IG scrape complete for user {user_id}: {total_posts} posts, {total_stories} stories")

        # Check for pending DMs
        pending_dms = ig.get_pending_dm_count()
        if pending_dms > 0:
            logger.info(f"Pending DMs for user {user_id}: {pending_dms}")

        total_new = total_posts + total_stories
        email_recipient = db.get_user_config(user_id, "email_recipient")
        if config.IG_DIGEST_MODE == "oneshot":
            logger.info(f"IG_DIGEST_MODE=oneshot, skipping inline IG-only digest email for user {user_id}")
        elif email_recipient and (total_new > 0 or pending_dms > 0):
            run_info = db.get_scrape_run(run_id)
            new_posts = db.get_new_posts_since(user_id, run_info["started_at"])
            for post in new_posts:
                post["media"] = db.get_media_for_post(post["id"])
            html, attachments = digest.build_html(new_posts, pending_dms=pending_dms)
            digest.send(email_recipient, html, total_new, attachments=attachments, pending_dms=pending_dms)
            logger.info(f"Digest email sent for user {user_id}.")
    except SessionExpiredError:
        logger.warning(f"Session expired during IG scrape for user {user_id}")
        cookie_mgr.mark_stale(user_id)
        db.finish_scrape_run(run_id, "error", error="Session expired — update cookies")
    except Exception as e:
        logger.error(f"IG scrape failed for user {user_id}: {e}")
        db.finish_scrape_run(run_id, "error", error=str(e))
    finally:
        root_logger.removeHandler(db_handler)
        db.close()


def _run_fb_only_scrape(user_id: int):
    """Run only the Facebook scrape portion for a specific user."""
    logger.info(f"Starting FB-only scrape for user {user_id}...")
    config = Config()
    db = Database(config.DATABASE_PATH)
    db.initialize()

    run_id = db.insert_scrape_run(user_id)
    db_handler = DbLogHandler(lambda line: db.append_scrape_run_log(run_id, line))
    root_logger = logging.getLogger()
    root_logger.addHandler(db_handler)

    try:
        cookie_mgr = CookieManager(db, config.ENCRYPTION_KEY)
        fb_cookies = cookie_mgr.get_fb_cookies(user_id)

        if not fb_cookies:
            logger.warning(f"No FB cookies for user {user_id}. Skipping.")
            db.finish_scrape_run(run_id, "error", error="No FB cookies configured")
            return

        from src.facebook import FacebookClient
        fb = FacebookClient(fb_cookies)
        fb_session_ok = fb.validate_session()
        if fb_session_ok is None:
            logger.warning(f"FB rate limited during validation for user {user_id}, skipping.")
            db.finish_scrape_run(run_id, "error", error="FB rate limited during validation")
            return
        if not fb_session_ok:
            logger.warning(f"FB cookies are stale for user {user_id}!")
            cookie_mgr.mark_fb_stale(user_id)
            db.finish_scrape_run(run_id, "error", error="FB cookies are stale")
            return

        scraper = Scraper(db=db, ig_client=None, downloader=None, user_id=user_id, fb_client=fb)
        new_fb_posts = scraper.scrape_all_fb_groups()
        db.finish_scrape_run(run_id, "success", 0, 0)
        logger.info(f"FB scrape complete for user {user_id}: {new_fb_posts} new posts")
    except Exception as e:
        logger.error(f"FB scrape failed for user {user_id}: {e}")
        db.finish_scrape_run(run_id, "error", error=str(e))
    finally:
        root_logger.removeHandler(db_handler)
        db.close()


def check_user_fb_group_resolve():
    """Resolve placeholder FB group names for all active users."""
    config = Config()
    db = Database(config.DATABASE_PATH)
    db.initialize()

    try:
        users = db.get_all_active_users()
        for user in users:
            user_id = user["id"]
            status = db.get_user_config(user_id, "fb_group_resolve")
            if status != "pending":
                continue

            db.set_user_config(user_id, "fb_group_resolve", "running")

            cookie_mgr = CookieManager(db, config.ENCRYPTION_KEY)
            fb_cookies = cookie_mgr.get_fb_cookies(user_id)
            if not fb_cookies:
                logger.warning(f"Cannot resolve FB group names for user {user_id}: no FB cookies")
                db.set_user_config(user_id, "fb_group_resolve", "done")
                continue

            from src.facebook import FacebookClient
            fb = FacebookClient(fb_cookies)

            groups = db.get_all_fb_groups(user_id)
            for group in groups:
                if group["name"].startswith("Group "):
                    try:
                        real_name = fb.get_group_name(group["group_id"])
                        if real_name and not real_name.startswith("Group "):
                            db.upsert_fb_group(user_id, group["group_id"], real_name, group["url"])
                            logger.info(f"Resolved FB group {group['group_id']} -> {real_name} for user {user_id}")
                    except Exception as e:
                        logger.warning(f"Failed to resolve group {group['group_id']} for user {user_id}: {e}")

            db.set_user_config(user_id, "fb_group_resolve", "done")
    finally:
        db.close()


def check_newsletter_processing():
    """Classify new newsletter emails and click confirmation links for all active users."""
    config = Config()
    if not config.ANTHROPIC_API_KEY:
        return

    db = Database(config.DATABASE_PATH)
    db.initialize()

    try:
        users = db.get_all_active_users()
        for user in users:
            user_id = user["id"]
            try:
                classify_emails(user_id)
                click_confirmations(user_id)
                if config.NEWSLETTER_DIGEST_MODE != "oneshot":
                    summarize_new_emails(user_id)
            except Exception as e:
                logger.error(f"Newsletter processing error for user {user_id}: {e}")
    finally:
        db.close()


def check_newsletter_digest():
    """Check all user schedules and send newsletter digests when due."""
    config = Config()
    if config.NEWSLETTER_DIGEST_MODE == "oneshot":
        return  # Digest generation handled by Oneshot agent
    if not config.ANTHROPIC_API_KEY:
        return

    from zoneinfo import ZoneInfo
    now = datetime.now(ZoneInfo("Europe/Copenhagen"))
    today = now.strftime("%Y-%m-%d")
    current_dow = now.weekday()  # 0=Mon, 6=Sun
    current_minutes = now.hour * 60 + now.minute

    db = Database(config.DATABASE_PATH)
    db.initialize()

    try:
        users = db.get_all_active_users()
        for user in users:
            user_id = user["id"]
            schedules = get_schedules(db, user_id)

            if not schedules:
                # Fallback: no schedules configured, use NEWSLETTER_DIGEST_TIME env var (once daily)
                try:
                    target_h, target_m = map(int, config.NEWSLETTER_DIGEST_TIME.split(":"))
                    diff_minutes = abs(current_minutes - (target_h * 60 + target_m))
                    if diff_minutes > 2:
                        continue
                except ValueError:
                    continue

                last_digest = db.get_last_newsletter_digest_date(user_id)
                if last_digest == today:
                    continue

                try:
                    build_and_send_digest(user_id)
                except Exception as e:
                    logger.error(f"Newsletter digest error for user {user_id}: {e}")
                continue

            # Schedule-based: check each schedule
            for schedule in schedules:
                schedule_id = schedule.get("id", "default")
                try:
                    target_h, target_m = map(int, schedule["time"].split(":"))
                except (ValueError, KeyError):
                    continue

                # Check if current day-of-week matches
                # Schedule days: 0=Sun, 1=Mon, ..., 6=Sat (JS convention)
                # Python weekday: 0=Mon, ..., 6=Sun
                # Convert python dow to JS dow: (python_dow + 1) % 7  ->  Mon=1, Sun=0
                js_dow = (current_dow + 1) % 7
                schedule_days = schedule.get("days", [1, 2, 3, 4, 5, 6, 0])  # default all days
                if js_dow not in schedule_days:
                    continue

                # Check if within 2-minute window of target time
                diff_minutes = abs(current_minutes - (target_h * 60 + target_m))
                if diff_minutes > 2:
                    continue

                # Check if this schedule already ran today
                last_key = f"newsletter_last_digest_{schedule_id}"
                last_sent = db.get_user_config(user_id, last_key)
                if last_sent == today:
                    continue

                schedule_name = schedule.get("name") or schedule_id
                logger.info(f"Newsletter digest schedule '{schedule_name}' due for user {user_id} at {schedule['time']}")
                try:
                    build_and_send_digest(user_id, schedule_name=schedule_name)
                    db.set_user_config(user_id, last_key, today)
                except Exception as e:
                    logger.error(f"Newsletter digest error for user {user_id} schedule '{schedule_id}': {e}")
    finally:
        db.close()


_shutdown = False


def main():
    global _shutdown
    config = Config()

    db = Database(config.DATABASE_PATH)
    db.initialize()

    # Reset stale manual runs from previous crashes
    db.reset_stale_manual_runs()
    db.close()

    logger.info("Starting per-user polling scheduler...")

    def shutdown(signum, frame):
        global _shutdown
        logger.info("Shutting down...")
        _shutdown = True

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)

    # Track last run times for each polling job
    last_due_check = 0.0
    last_cookie_test = 0.0
    last_manual_run = 0.0
    last_trigger_check = 0.0
    last_fb_resolve = 0.0
    last_newsletter_check = 0.0
    last_newsletter_digest = 0.0

    while not _shutdown:
        now = time.monotonic()

        # check_due_scrapes every 60s
        if now - last_due_check >= 60:
            last_due_check = now
            try:
                check_due_scrapes()
            except Exception as e:
                logger.error(f"Error in check_due_scrapes: {e}")

        # check_user_cookie_tests every 10s
        if now - last_cookie_test >= 10:
            last_cookie_test = now
            try:
                check_user_cookie_tests()
            except Exception as e:
                logger.error(f"Error in check_user_cookie_tests: {e}")

        # check_user_manual_runs every 30s
        if now - last_manual_run >= 30:
            last_manual_run = now
            try:
                check_user_manual_runs()
            except Exception as e:
                logger.error(f"Error in check_user_manual_runs: {e}")

        # check_user_triggers every 10s
        if now - last_trigger_check >= 10:
            last_trigger_check = now
            try:
                check_user_triggers()
            except Exception as e:
                logger.error(f"Error in check_user_triggers: {e}")

        # check_user_fb_group_resolve every 10s
        if now - last_fb_resolve >= 10:
            last_fb_resolve = now
            try:
                check_user_fb_group_resolve()
            except Exception as e:
                logger.error(f"Error in check_user_fb_group_resolve: {e}")

        # check_newsletter_processing every 60s
        if now - last_newsletter_check >= 60:
            last_newsletter_check = now
            try:
                check_newsletter_processing()
            except Exception as e:
                logger.error(f"Error in check_newsletter_processing: {e}")

        # check_newsletter_digest every 60s
        if now - last_newsletter_digest >= 60:
            last_newsletter_digest = now
            try:
                check_newsletter_digest()
            except Exception as e:
                logger.error(f"Error in check_newsletter_digest: {e}")

        # Sleep briefly to avoid busy-waiting
        time.sleep(1)

    logger.info("Scheduler stopped.")


if __name__ == "__main__":
    main()
