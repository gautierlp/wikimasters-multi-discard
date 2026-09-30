"""Session handling: the browser cookie, the session file, and the token refresh.

The site uses Supabase Auth. The browser keeps the session in a cookie named
sb-<project-ref>-auth-token, split in 3180-character chunks (.0, .1, ...).
Joined, the value is "base64-" followed by base64url JSON.
"""

from __future__ import annotations

import base64
import os
import re
from pathlib import Path

from .models import Session

# Public values: both ship in the site's JavaScript and reach every visitor.
# The anon key only lets a client talk to Supabase Auth; it grants no data on its own.
PROJECT_REF = "cyrxjeppjqsxxjayfrur"
ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN5cnhqZXBwanFzeHhqYXlmcnVyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4ODAzMzksImV4cCI6MjA4OTQ1NjMzOX0.BZluyXygNxuQGDPxFX1zG5i-cqp10CVK-8GGtuak4Rg"
COOKIE_NAME = f"sb-{PROJECT_REF}-auth-token"
CHUNK_SIZE = 3180
PREFIX = "base64-"

_CHUNK_RE = re.compile(re.escape(COOKIE_NAME) + r"(?:\.(\d+))?=([A-Za-z0-9_\-]+)")


class LoginRequired(Exception):
    """The CLI has no usable session. The user must run `wm login`."""


def parse_cookie_header(text: str) -> Session:
    """Find the auth cookie chunks anywhere in `text` and decode the session."""
    found = _CHUNK_RE.findall(text)
    if not found:
        raise LoginRequired(f"No {COOKIE_NAME} cookie found in the pasted text.")
    chunks = sorted(found, key=lambda m: int(m[0] or 0))
    value = "".join(v for _, v in chunks)
    if not value.startswith(PREFIX):
        raise LoginRequired("The cookie value does not start with 'base64-'.")
    raw = value[len(PREFIX) :]
    data = base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4))
    return Session.model_validate_json(data)


def build_cookie_header(session: Session) -> str:
    """The reverse of parse_cookie_header, with the browser's own chunk rule."""
    payload = session.model_dump_json(by_alias=True)
    value = PREFIX + base64.urlsafe_b64encode(payload.encode()).decode().rstrip("=")
    if len(value) <= CHUNK_SIZE:
        return f"{COOKIE_NAME}={value}"
    chunks = [value[i : i + CHUNK_SIZE] for i in range(0, len(value), CHUNK_SIZE)]
    return "; ".join(f"{COOKIE_NAME}.{i}={chunk}" for i, chunk in enumerate(chunks))


def default_config_dir() -> Path:
    env = os.environ.get("WM_CONFIG_DIR")
    return Path(env) if env else Path.home() / ".config" / "wikimasters"


class SessionStore:
    """The session file on disk."""

    def __init__(self, path: Path | None = None) -> None:
        self.path = Path(path) if path else default_config_dir() / "session.json"

    def load(self) -> Session:
        if not self.path.exists():
            raise LoginRequired("Not logged in. Run `wm login`.")
        return Session.model_validate_json(self.path.read_text())

    def save(self, session: Session) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(session.model_dump_json(by_alias=True))
        self.path.chmod(0o600)
