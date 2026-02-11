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

    run_id = db.insert_scrape_run()

    # Attach DB log handler to capture all logs for this run
    db_handler = DbLogHandler(lambda line: db.append_scrape_run_log(run_id, line))
    root_logger = logging.getLogger()
    root_logger.addHandler(db_handler)

    try:
        cookie_mgr = CookieManager(db, config.ENCRYPTION_KEY)
        cookies = cookie_mgr.get_cookies()

        digest = DigestBuilder(
            resend_api_key=config.RESEND_API_KEY,
            base_url=config.BASE_URL,
            media_path=config.MEDIA_PATH,
        )

        if not cookies:
            logger.warning("No cookies configured. Skipping.")
            db.finish_scrape_run(run_id, "error", error="No cookies configured")
            return

        ig = InstagramClient(cookies)
        session_ok = ig.validate_session()
        if session_ok is None:
            logger.warning("Rate limited during validation, skipping this run.")
            db.finish_scrape_run(run_id, "error", error="Rate limited during validation")
            return
        if not session_ok:
            logger.warning("Cookies are stale!")
            cookie_mgr.mark_stale()
            db.finish_scrape_run(run_id, "error", error="Cookies are stale")
            if config.EMAIL_RECIPIENT:
                try:
                    digest.send_stale_cookies_alert(config.EMAIL_RECIPIENT)
                except Exception as e:
                    logger.error(f"Failed to send stale cookies alert: {e}")
            return

        downloader = MediaDownloader(config.MEDIA_PATH)
        scraper = Scraper(db=db, ig_client=ig, downloader=downloader)

        logger.info("Syncing following list...")
        scraper.sync_following()

        total_posts, total_stories = scraper.scrape_all()
        db.finish_scrape_run(run_id, "success", total_posts, total_stories)
        logger.info(f"Scrape complete: {total_posts} posts, {total_stories} stories")

        # --- Facebook scraping ---
        new_fb_posts = 0
        fb_cookie_mgr_cookies = cookie_mgr.get_fb_cookies()
        if fb_cookie_mgr_cookies:
            from src.facebook import FacebookClient
            fb = FacebookClient(fb_cookie_mgr_cookies)
            fb_session_ok = fb.validate_session()
            if fb_session_ok is None:
                logger.warning("FB rate limited during validation, skipping FB this run.")
            elif not fb_session_ok:
                logger.warning("FB cookies are stale!")
                cookie_mgr.mark_fb_stale()
            else:
                scraper.fb = fb
                new_fb_posts = scraper.scrape_all_fb_groups()
                logger.info(f"FB scrape complete: {new_fb_posts} new posts")
        else:
            logger.info("No FB cookies configured, skipping Facebook scraping.")

        total_new = total_posts + total_stories + new_fb_posts
        if total_new > 0 and config.EMAIL_RECIPIENT:
            run_info = db.get_scrape_run(run_id)
            new_posts = db.get_new_posts_since(run_info["started_at"])
            for post in new_posts:
                post["media"] = db.get_media_for_post(post["id"])
            new_fb = db.get_new_fb_posts_since(run_info["started_at"])
            html, attachments = digest.build_html(new_posts, new_fb)
            digest.send(config.EMAIL_RECIPIENT, html, total_new, attachments=attachments)
            logger.info("Digest email sent.")

    except Exception as e:
        logger.error(f"Scrape failed: {e}")
        db.finish_scrape_run(run_id, "error", error=str(e))
    finally:
        root_logger.removeHandler(db_handler)
        db.close()


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


def check_fb_cookie_test():
    config = Config()
    db = Database(config.DATABASE_PATH)
    db.initialize()

    status = db.get_config("fb_cookie_test")
    if status != "pending":
        db.close()
        return

    logger.info("FB cookie test requested, validating session...")
    db.set_config("fb_cookie_test", "running")
    log_lines = []

    def log(msg):
        log_lines.append(msg)
        db.set_config("fb_cookie_test_log", "\n".join(log_lines))
        logger.info(f"[fb_cookie_test] {msg}")

    log("Loading FB cookies from database...")
    cookie_mgr = CookieManager(db, config.ENCRYPTION_KEY)
    cookies = cookie_mgr.get_fb_cookies()

    if not cookies:
        log("ERROR: No FB cookies configured.")
        db.set_config("fb_cookie_test", "error:No FB cookies configured")
        db.close()
        return

    has_c_user = bool(cookies.get("c_user"))
    has_xs = bool(cookies.get("xs"))
    log(f"Found cookies: c_user={'yes' if has_c_user else 'MISSING'}, xs={'yes' if has_xs else 'MISSING'}")

    if not has_c_user or not has_xs:
        log("ERROR: c_user and xs cookies are required.")
        db.set_config("fb_cookie_test", "error:Required cookies missing (c_user, xs)")
        db.close()
        return

    log("Creating Facebook client...")
    from src.facebook import FacebookClient
    fb = FacebookClient(cookies)

    log("Testing session against mbasic.facebook.com ...")

    try:
        session_ok = fb.validate_session()
    except Exception as e:
        log(f"ERROR: {e}")
        db.set_config("fb_cookie_test", f"error:{e}")
        db.close()
        return

    if session_ok is None:
        log("RESULT: Rate limited by Facebook. Try again later.")
        db.set_config("fb_cookie_test", "error:Rate limited, try again later")
    elif session_ok:
        log(f"RESULT: FB cookies valid — logged in as user {cookies.get('c_user', 'unknown')}")
        db.set_config("fb_cookie_test", f"valid:{cookies.get('c_user', 'unknown')}")
    else:
        log("RESULT: FB cookies are stale or invalid. Re-sync from browser.")
        db.set_config("fb_cookie_test", "error:FB cookies are stale or invalid")

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
    db_handler = DbLogHandler(lambda line: db.append_manual_run_log(run_id, line))
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


def run_ig_scrape():
    """Run only the Instagram scrape portion."""
    logger.info("Starting IG-only scrape...")
    config = Config()
    db = Database(config.DATABASE_PATH)
    db.initialize()

    run_id = db.insert_scrape_run()
    db_handler = DbLogHandler(lambda line: db.append_scrape_run_log(run_id, line))
    root_logger = logging.getLogger()
    root_logger.addHandler(db_handler)

    try:
        cookie_mgr = CookieManager(db, config.ENCRYPTION_KEY)
        cookies = cookie_mgr.get_cookies()
        digest = DigestBuilder(
            resend_api_key=config.RESEND_API_KEY,
            base_url=config.BASE_URL,
            media_path=config.MEDIA_PATH,
        )

        if not cookies:
            logger.warning("No IG cookies configured. Skipping.")
            db.finish_scrape_run(run_id, "error", error="No IG cookies configured")
            return

        ig = InstagramClient(cookies)
        session_ok = ig.validate_session()
        if session_ok is None:
            logger.warning("Rate limited during validation, skipping this run.")
            db.finish_scrape_run(run_id, "error", error="Rate limited during validation")
            return
        if not session_ok:
            logger.warning("IG cookies are stale!")
            cookie_mgr.mark_stale()
            db.finish_scrape_run(run_id, "error", error="Cookies are stale")
            return

        downloader = MediaDownloader(config.MEDIA_PATH)
        scraper = Scraper(db=db, ig_client=ig, downloader=downloader)

        logger.info("Syncing following list...")
        scraper.sync_following()

        total_posts, total_stories = scraper.scrape_all()
        db.finish_scrape_run(run_id, "success", total_posts, total_stories)
        logger.info(f"IG scrape complete: {total_posts} posts, {total_stories} stories")

        total_new = total_posts + total_stories
        if total_new > 0 and config.EMAIL_RECIPIENT:
            run_info = db.get_scrape_run(run_id)
            new_posts = db.get_new_posts_since(run_info["started_at"])
            for post in new_posts:
                post["media"] = db.get_media_for_post(post["id"])
            html, attachments = digest.build_html(new_posts)
            digest.send(config.EMAIL_RECIPIENT, html, total_new, attachments=attachments)
            logger.info("Digest email sent.")
    except Exception as e:
        logger.error(f"IG scrape failed: {e}")
        db.finish_scrape_run(run_id, "error", error=str(e))
    finally:
        root_logger.removeHandler(db_handler)
        db.close()


def run_fb_scrape():
    """Run only the Facebook scrape portion."""
    logger.info("Starting FB-only scrape...")
    config = Config()
    db = Database(config.DATABASE_PATH)
    db.initialize()

    try:
        cookie_mgr = CookieManager(db, config.ENCRYPTION_KEY)
        fb_cookies = cookie_mgr.get_fb_cookies()

        if not fb_cookies:
            logger.warning("No FB cookies configured. Skipping.")
            return

        from src.facebook import FacebookClient
        fb = FacebookClient(fb_cookies)
        fb_session_ok = fb.validate_session()
        if fb_session_ok is None:
            logger.warning("FB rate limited during validation, skipping.")
            return
        if not fb_session_ok:
            logger.warning("FB cookies are stale!")
            cookie_mgr.mark_fb_stale()
            return

        scraper = Scraper(db=db, ig_client=None, downloader=None, fb_client=fb)
        new_fb_posts = scraper.scrape_all_fb_groups()
        logger.info(f"FB scrape complete: {new_fb_posts} new posts")
    except Exception as e:
        logger.error(f"FB scrape failed: {e}")
    finally:
        db.close()


def check_trigger_scrape():
    config = Config()
    db = Database(config.DATABASE_PATH)
    db.initialize()

    status = db.get_config("trigger_scrape")
    if status != "pending":
        db.close()
        return

    logger.info("Manual scrape trigger detected, starting scrape...")
    db.set_config("trigger_scrape", "running")
    db.close()

    run_scrape()

    db = Database(config.DATABASE_PATH)
    db.initialize()
    db.set_config("trigger_scrape", "done")
    db.close()


def check_trigger_ig_scrape():
    config = Config()
    db = Database(config.DATABASE_PATH)
    db.initialize()

    status = db.get_config("trigger_ig_scrape")
    if status != "pending":
        db.close()
        return

    logger.info("Manual IG scrape trigger detected...")
    db.set_config("trigger_ig_scrape", "running")
    db.close()

    run_ig_scrape()

    db = Database(config.DATABASE_PATH)
    db.initialize()
    db.set_config("trigger_ig_scrape", "done")
    db.close()


def check_trigger_fb_scrape():
    config = Config()
    db = Database(config.DATABASE_PATH)
    db.initialize()

    status = db.get_config("trigger_fb_scrape")
    if status != "pending":
        db.close()
        return

    logger.info("Manual FB scrape trigger detected...")
    db.set_config("trigger_fb_scrape", "running")
    db.close()

    run_fb_scrape()

    db = Database(config.DATABASE_PATH)
    db.initialize()
    db.set_config("trigger_fb_scrape", "done")
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
    scheduler.add_job(
        check_fb_cookie_test,
        IntervalTrigger(seconds=10),
        id="fb_cookie_test_check",
        name="FB Cookie Test Check",
    )
    scheduler.add_job(
        check_trigger_scrape,
        IntervalTrigger(seconds=10),
        id="trigger_scrape_check",
        name="Trigger Scrape Check",
    )
    scheduler.add_job(
        check_trigger_ig_scrape,
        IntervalTrigger(seconds=10),
        id="trigger_ig_scrape_check",
        name="Trigger IG Scrape Check",
    )
    scheduler.add_job(
        check_trigger_fb_scrape,
        IntervalTrigger(seconds=10),
        id="trigger_fb_scrape_check",
        name="Trigger FB Scrape Check",
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
