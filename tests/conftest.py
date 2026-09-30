import json
import time
from pathlib import Path

import pytest

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture
def page_json() -> dict:
    return json.loads((FIXTURES / "collection_page.json").read_text())


def make_session_dict(expires_in_s: int = 3600) -> dict:
    """An invented Supabase session, shaped like the real cookie JSON."""
    now = int(time.time())
    return {
        "access_token": "access-1",
        "token_type": "bearer",
        "expires_in": 3600,
        "expires_at": now + expires_in_s,
        "refresh_token": "refresh-1",
        "user": {
            "id": "<user-uuid>",
            "aud": "authenticated",
            "user_metadata": {"username": "tester"},
        },
    }


@pytest.fixture
def session_dict() -> dict:
    return make_session_dict()
