import os


class Config:
    DATABASE_PATH = os.environ.get("DATABASE_PATH", "/data/db/ig.db")
    MEDIA_PATH = os.environ.get("MEDIA_PATH", "/data/media")
    ENCRYPTION_KEY = os.environ.get("ENCRYPTION_KEY", "")
    RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "")
    BASE_URL = os.environ.get("BASE_URL", "https://ig.raakode.dk")
    ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
    NEWSLETTER_DIGEST_TIME = os.environ.get("NEWSLETTER_DIGEST_TIME", "07:00")
