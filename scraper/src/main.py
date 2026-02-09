import logging
import signal
import sys
from apscheduler.schedulers.blocking import BlockingScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger

from src.config import Config
from src.db import Database
from src.cookies import CookieManager
from src.instagram import InstagramClient
from src.downloader import MediaDownloader
from src.scrape import Scraper
from src.digest import DigestBuilder

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


def run_scrape():
    logger.info("Starting scrape run...")
    config = Config()
    db = Database(config.DATABASE_PATH)
    db.initialize()

    cookie_mgr = CookieManager(db, config.ENCRYPTION_KEY)
    cookies = cookie_mgr.get_cookies()

    digest = DigestBuilder(
        resend_api_key=config.RESEND_API_KEY,
        base_url=config.BASE_URL,
    )

    if not cookies:
        logger.warning("No cookies configured. Skipping.")
        return

    ig = InstagramClient(cookies)
    session_ok = ig.validate_session()
    if session_ok is None:
        logger.warning("Rate limited during validation, skipping this run.")
        return
    if not session_ok:
        logger.warning("Cookies are stale!")
        cookie_mgr.mark_stale()
        if config.EMAIL_RECIPIENT:
            try:
                digest.send_stale_cookies_alert(config.EMAIL_RECIPIENT)
            except Exception as e:
                logger.error(f"Failed to send stale cookies alert: {e}")
        return

    run_id = db.insert_scrape_run()
    downloader = MediaDownloader(config.MEDIA_PATH)
    scraper = Scraper(db=db, ig_client=ig, downloader=downloader)

    try:
        accounts = db.get_all_accounts()
        if not accounts:
            logger.info("No accounts found. Syncing following list...")
            scraper.sync_following()

        total_posts, total_stories = scraper.scrape_all()
        db.finish_scrape_run(run_id, "success", total_posts, total_stories)
        logger.info(f"Scrape complete: {total_posts} posts, {total_stories} stories")

        if (total_posts + total_stories) > 0 and config.EMAIL_RECIPIENT:
            run_info = db.get_scrape_run(run_id)
            new_posts = db.get_new_posts_since(run_info["started_at"])
            for post in new_posts:
                post["media"] = db.get_media_for_post(post["id"])
            html = digest.build_html(new_posts)
            digest.send(config.EMAIL_RECIPIENT, html, total_posts + total_stories)
            logger.info("Digest email sent.")

    except Exception as e:
        logger.error(f"Scrape failed: {e}")
        db.finish_scrape_run(run_id, "error")

    db.close()


class DbLogHandler(logging.Handler):
    """Logging handler that appends log lines to a manual_run's log column."""
    def __init__(self, db: Database, run_id: int):
        super().__init__()
        self._db = db
        self._run_id = run_id
        self.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))

    def emit(self, record):
        try:
            self._db.append_manual_run_log(self._run_id, self.format(record))
        except Exception:
            pass


def check_cookie_test():
    config = Config()
    db = Database(config.DATABASE_PATH)
    db.initialize()

    status = db.get_config("cookie_test")
    if status != "pending":
        db.close()
        return

    logger.info("Cookie test requested, validating session...")
    db.set_config("cookie_test", "running")
    log_lines = []

    def log(msg):
        log_lines.append(msg)
        db.set_config("cookie_test_log", "\n".join(log_lines))
        logger.info(f"[cookie_test] {msg}")

    log("Loading cookies from database...")
    cookie_mgr = CookieManager(db, config.ENCRYPTION_KEY)
    cookies = cookie_mgr.get_cookies()

    if not cookies:
        log("ERROR: No cookies configured.")
        db.set_config("cookie_test", "error:No cookies configured")
        db.close()
        return

    has_session = bool(cookies.get("sessionid"))
    has_csrf = bool(cookies.get("csrftoken"))
    has_dsuid = bool(cookies.get("ds_user_id"))
    log(f"Found cookies: sessionid={'yes' if has_session else 'MISSING'}, "
        f"csrftoken={'yes' if has_csrf else 'MISSING'}, "
        f"ds_user_id={cookies.get('ds_user_id', 'MISSING')}")

    if not has_session:
        log("ERROR: sessionid cookie is required.")
        db.set_config("cookie_test", "error:sessionid cookie missing")
        db.close()
        return

    log("Creating Instagram client...")
    ig = InstagramClient(cookies)

    log("Testing session against Instagram API (GET /api/v1/users/web_profile_info/) ...")
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
        db.set_config("cookie_test", "error:Rate limited, try again later")
    elif session_ok:
        log("Session is valid! Fetching username...")
        username = ig.get_logged_in_username()
        log(f"RESULT: Cookies valid — logged in as @{username}")
        db.set_config("cookie_test", f"valid:{username}")
    else:
        log("RESULT: Cookies are stale or invalid. Re-sync from browser.")
        db.set_config("cookie_test", "error:Cookies are stale or invalid")

    db.close()


def check_manual_runs():
    config = Config()
    db = Database(config.DATABASE_PATH)
    db.initialize()

    run = db.get_pending_manual_run()
    if not run:
        db.close()
        return

    run_id = run["id"]
    since_date = run["since_date"]
    logger.info(f"Starting manual run #{run_id} (since {since_date})...")
    db.start_manual_run(run_id)

    # Attach DB log handler for this run
    db_handler = DbLogHandler(db, run_id)
    root_logger = logging.getLogger()
    root_logger.addHandler(db_handler)

    try:
        cookie_mgr = CookieManager(db, config.ENCRYPTION_KEY)
        cookies = cookie_mgr.get_cookies()

        if not cookies:
            logger.warning("No cookies for manual run.")
            db.finish_manual_run(run_id, "error", error="No cookies configured")
            return

        ig = InstagramClient(cookies)
        session_ok = ig.validate_session()
        if session_ok is None:
            logger.warning("Rate limited during manual run validation.")
            db.finish_manual_run(run_id, "error", error="Rate limited, try again later")
            return
        if not session_ok:
            logger.warning("Stale cookies for manual run.")
            cookie_mgr.mark_stale()
            db.finish_manual_run(run_id, "error", error="Cookies are stale")
            return

        downloader = MediaDownloader(config.MEDIA_PATH)
        scraper = Scraper(db=db, ig_client=ig, downloader=downloader)

        total_posts, total_stories = scraper.scrape_all_backfill(since_date)
        db.finish_manual_run(run_id, "success", total_posts, total_stories)
        logger.info(f"Manual run #{run_id} complete: {total_posts} posts, {total_stories} stories")
    except Exception as e:
        logger.error(f"Manual run #{run_id} failed: {e}")
        db.finish_manual_run(run_id, "error", error=str(e))
    finally:
        root_logger.removeHandler(db_handler)
        db.close()


def main():
    config = Config()

    db = Database(config.DATABASE_PATH)
    db.initialize()

    # Reset stale manual runs from previous crashes
    db.reset_stale_manual_runs()

    if not db.get_config("cron_schedule"):
        db.set_config("cron_schedule", config.CRON_SCHEDULE)
    db.close()

    db = Database(config.DATABASE_PATH)
    cron_expr = db.get_config("cron_schedule") or config.CRON_SCHEDULE
    db.close()

    logger.info(f"Starting scheduler with cron: {cron_expr}")

    scheduler = BlockingScheduler()
    scheduler.add_job(
        run_scrape,
        CronTrigger.from_crontab(cron_expr),
        id="scrape_job",
        name="Instagram Scrape",
        misfire_grace_time=3600,
    )
    scheduler.add_job(
        check_manual_runs,
        IntervalTrigger(seconds=30),
        id="manual_run_check",
        name="Manual Run Check",
    )
    scheduler.add_job(
        check_cookie_test,
        IntervalTrigger(seconds=10),
        id="cookie_test_check",
        name="Cookie Test Check",
    )

    # No initial scrape on startup — wait for cron to avoid burst traffic
    logger.info("Waiting for scheduled cron to trigger first scrape.")

    def shutdown(signum, frame):
        logger.info("Shutting down...")
        scheduler.shutdown(wait=False)
        sys.exit(0)

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)

    scheduler.start()


if __name__ == "__main__":
    main()
