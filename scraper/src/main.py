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
    if not ig.validate_session():
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
        if not ig.validate_session():
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

    logger.info("Running initial scrape...")
    run_scrape()

    def shutdown(signum, frame):
        logger.info("Shutting down...")
        scheduler.shutdown(wait=False)
        sys.exit(0)

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)

    scheduler.start()


if __name__ == "__main__":
    main()
