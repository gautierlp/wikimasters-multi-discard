"""Session handling: the browser cookie, the session file, and the token refresh.

The site uses Supabase Auth. The browser keeps the session in a cookie named
sb-<project-ref>-auth-token, split in 3180-character chunks (.0, .1, ...).
Joined, the value is "base64-" followed by base64url JSON.
"""

from __future__ import annotations

import base64
import binascii
import os
import re
import time
from pathlib import Path

import httpx
from pydantic import ValidationError

from .models import Session

# Public values: both ship in the site's JavaScript and reach every visitor.
# The anon key only lets a client talk to Supabase Auth; it grants no data on its own.
PROJECT_REF = "cyrxjeppjqsxxjayfrur"
ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN5cnhqZXBwanFzeHhqYXlmcnVyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4ODAzMzksImV4cCI6MjA4OTQ1NjMzOX0.BZluyXygNxuQGDPxFX1zG5i-cqp10CVK-8GGtuak4Rg"
COOKIE_NAME = f"sb-{PROJECT_REF}-auth-token"
CHUNK_SIZE = 3180
PREFIX = "base64-"
REFRESH_URL = f"https://{PROJECT_REF}.supabase.co/auth/v1/token?grant_type=refresh_token"
REFRESH_MARGIN_S = 60

_CHUNK_RE = re.compile(re.escape(COOKIE_NAME) + r"(?:\.(\d+))?=([A-Za-z0-9_\-]+)")


class LoginRequired(Exception):
    """The CLI has no usable session. The user must run `wm login`."""


class RefreshFailed(Exception):
    """The token refresh call failed; the session is still valid but refresh needs retry."""


def parse_cookie_header(text: str) -> Session:
    """Find the auth cookie chunks anywhere in `text` and decode the session."""
    found = _CHUNK_RE.findall(text)
    if not found:
        raise LoginRequired(f"No {COOKIE_NAME} cookie found in the pasted text.")
    chunk_dict = {}
    for index, value in found:
        idx = int(index or 0)
        if idx not in chunk_dict:
            chunk_dict[idx] = value
    chunks = [chunk_dict[i] for i in sorted(chunk_dict.keys())]
    value = "".join(chunks)
    if not value.startswith(PREFIX):
        raise LoginRequired("The cookie value does not start with 'base64-'.")
    raw = value[len(PREFIX) :]
    try:
        data = base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4))
        return Session.model_validate_json(data)
    except (ValueError, binascii.Error) as e:
        raise LoginRequired(f"Could not decode the cookie: {e}")


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
        try:
            return Session.model_validate_json(self.path.read_text())
        except ValueError as e:
            raise LoginRequired("The session file is unreadable. Run `wm login` again.")

    def save(self, session: Session) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(self.path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as f:
            f.write(session.model_dump_json(by_alias=True))


def refresh(session: Session, http: httpx.Client) -> Session:
    """Exchange the refresh token for a new session. The old refresh token dies."""
    response = http.post(
        REFRESH_URL,
        headers={"apikey": ANON_KEY},
        json={"refresh_token": session.refresh_token},
    )
    if response.status_code != 200:
        if 400 <= response.status_code < 500:
            raise LoginRequired("Session expired. Run `wm login` again.")
        raise RefreshFailed(f"Could not refresh the session (HTTP {response.status_code}). Try again later.")
    try:
        return Session.model_validate(response.json())
    except ValueError:
        raise RefreshFailed("Could not refresh the session: unexpected answer from the auth service.")


def ensure_fresh(store: SessionStore, http: httpx.Client, now: float | None = None) -> Session:
    """Load the session; refresh and save it when the access token is about to expire."""
    session = store.load()
    current = time.time() if now is None else now
    if session.expires_at - current < REFRESH_MARGIN_S:
        session = refresh(session, http)
        store.save(session)
    return session
