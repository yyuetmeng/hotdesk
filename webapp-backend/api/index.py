"""Vercel serverless entry point: exposes the Flask app as `app` for the Python runtime."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import create_app  # noqa: E402

app = create_app()
