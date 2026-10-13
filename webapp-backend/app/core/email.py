import logging

import resend

from app.core.config import Config

log = logging.getLogger("app.email")


def send_email(to: str, subject: str, html: str) -> None:
    resend.api_key = Config.RESEND_API_KEY
    resp = resend.Emails.send({"from": Config.EMAIL_FROM, "to": to,
                               "subject": subject, "html": html})
    if resp is None or (isinstance(resp, dict) and resp.get("name") and not resp.get("id")):
        log.error("resend send failed: %s", resp)
        raise RuntimeError("email send failed")
