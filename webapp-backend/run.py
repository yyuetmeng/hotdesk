import os
from pathlib import Path

from app import create_app

app = create_app()

if __name__ == "__main__":
    # Development by default: debug mode with auto-reload, so saved code restarts the server within a second.
    # The "stat" reloader polls file times, which works in this OneDrive folder (no extra package needed),
    # and .env is watched too. Set FLASK_DEBUG=0 to run without debug or reload (never debug in production).
    dev = os.getenv("FLASK_DEBUG", "1").lower() not in ("0", "false", "no")
    env_file = Path(__file__).with_name(".env")
    app.run(debug=dev, use_reloader=dev, reloader_type="stat", port=int(os.getenv("PORT", "5000")),
            extra_files=[str(env_file)] if dev and env_file.exists() else None)
