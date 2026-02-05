import os


class Config:
    DATABASE_PATH = os.environ.get("DATABASE_PATH", "/data/db/ig.db")
    MEDIA_PATH = os.environ.get("MEDIA_PATH", "/data/media")
    ENCRYPTION_KEY = os.environ.get("ENCRYPTION_KEY", "")
    RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "")
    EMAIL_RECIPIENT = os.environ.get("EMAIL_RECIPIENT", "")
    CRON_SCHEDULE = os.environ.get("CRON_SCHEDULE", "0 8 * * *")
    BASE_URL = os.environ.get("BASE_URL", "https://ig.raakode.dk")
