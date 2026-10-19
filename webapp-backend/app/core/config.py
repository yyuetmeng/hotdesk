import os

from dotenv import load_dotenv

load_dotenv()


class Config:
    # No built-in fallbacks: create_app refuses to start without these (see REQUIRED), so a known signing key or a
    # sample connection string never ends up in use or in the code.
    SECRET_KEY = os.getenv("SECRET_KEY", "")
    SQLALCHEMY_DATABASE_URI = os.getenv("SUPABASE_CONNECTION_STRING", "")
    SQLALCHEMY_ENGINE_OPTIONS = {
        "pool_pre_ping": True,
        "pool_recycle": 300,
    }
    JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY") or SECRET_KEY
    JWT_ACCESS_TOKEN_EXPIRES = int(os.getenv("JWT_ACCESS_TOKEN_EXPIRES", "43200"))
    # "Keep me signed in on this device": a longer token, kept in the browser beyond the tab (5 days).
    JWT_REMEMBER_EXPIRES = int(os.getenv("JWT_REMEMBER_EXPIRES", "432000"))
    RESEND_API_KEY = os.getenv("RESEND_API_KEY", "")
    EMAIL_FROM = os.getenv("EMAIL_FROM", "")
    FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")
    LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")
    # Seat booking: "today", "tomorrow" and slot times are in this zone.
    BOOKING_TIMEZONE = os.getenv("BOOKING_TIMEZONE", "Asia/Singapore")
    LOG_FILE = os.getenv("LOG_FILE", "")
