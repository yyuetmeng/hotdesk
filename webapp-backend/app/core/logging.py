import logging
import time
from logging.handlers import RotatingFileHandler


def setup_logging(app):
    logging.Formatter.converter = time.gmtime
    level = getattr(logging, str(app.config.get("LOG_LEVEL", "INFO")).upper(), logging.INFO)
    fmt = logging.Formatter("%(asctime)s %(levelname)s [%(name)s] %(message)s")
    logging.getLogger().setLevel(logging.WARNING)
    log = logging.getLogger("app")
    log.setLevel(level)
    if not log.handlers:
        console = logging.StreamHandler()
        console.setFormatter(fmt)
        log.addHandler(console)
        path = app.config.get("LOG_FILE")
        if path:
            file_handler = RotatingFileHandler(path, maxBytes=1_000_000, backupCount=5)
            file_handler.setFormatter(fmt)
            log.addHandler(file_handler)
    return log
