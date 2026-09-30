import base64
import json
import stat

import pytest

from wikimasters import auth
from wikimasters.auth import (
    COOKIE_NAME,
    LoginRequired,
    SessionStore,
    build_cookie_header,
    parse_cookie_header,
)
from wikimasters.models import Session

from .conftest import make_session_dict


def encode_cookie_value(data: dict) -> str:
    raw = base64.urlsafe_b64encode(json.dumps(data, separators=(",", ":")).encode()).decode()
    return "base64-" + raw.rstrip("=")


def test_parse_two_chunk_header(session_dict):
    session_dict["user"]["padding"] = "x" * 4000  # force two chunks
    value = encode_cookie_value(session_dict)
    assert len(value) > auth.CHUNK_SIZE
    header = f"{COOKIE_NAME}.0={value[:auth.CHUNK_SIZE]}; {COOKIE_NAME}.1={value[auth.CHUNK_SIZE:]}"
    session = parse_cookie_header(header)
    assert session.access_token == "access-1"
    assert session.user.username == "tester"


def test_parse_whole_curl_command(session_dict):
    value = encode_cookie_value(session_dict)
    text = f"curl 'https://example.test/api' \\\n  -b '{COOKIE_NAME}={value}' \\\n  -H 'accept: */*'"
    assert parse_cookie_header(text).refresh_token == "refresh-1"


def test_parse_missing_cookie():
    with pytest.raises(LoginRequired):
        parse_cookie_header("foo=bar; other=1")


def test_round_trip_long_session(session_dict):
    session_dict["user"]["padding"] = "y" * 4000
    session = Session.model_validate(session_dict)
    header = build_cookie_header(session)
    assert f"{COOKIE_NAME}.0=" in header and f"{COOKIE_NAME}.1=" in header
    for part in header.split("; "):
        assert len(part.split("=", 1)[1]) <= auth.CHUNK_SIZE
    again = parse_cookie_header(header)
    assert again.model_dump() == session.model_dump()


def test_build_short_session_uses_bare_name(session_dict):
    header = build_cookie_header(Session.model_validate(session_dict))
    assert header.startswith(f"{COOKIE_NAME}=base64-")
    assert ".0=" not in header


def test_store_save_and_load(tmp_path, session_dict):
    store = SessionStore(tmp_path / "session.json")
    store.save(Session.model_validate(session_dict))
    mode = stat.S_IMODE(store.path.stat().st_mode)
    assert mode == 0o600
    assert store.load().access_token == "access-1"


def test_store_missing_file(tmp_path):
    with pytest.raises(LoginRequired, match="Not logged in"):
        SessionStore(tmp_path / "nope.json").load()


def test_store_default_path_uses_env(monkeypatch, tmp_path):
    monkeypatch.setenv("WM_CONFIG_DIR", str(tmp_path))
    assert SessionStore().path == tmp_path / "session.json"
