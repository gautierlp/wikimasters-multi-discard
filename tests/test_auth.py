import base64
import json
import stat

import httpx
import pytest

from wikimasters import auth
from wikimasters.auth import (
    ANON_KEY,
    COOKIE_NAME,
    LoginRequired,
    REFRESH_URL,
    RefreshFailed,
    SessionStore,
    build_cookie_header,
    ensure_fresh,
    parse_cookie_header,
    refresh,
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


def test_parse_garbled_cookie():
    garbled = f"{COOKIE_NAME}=base64-!!!notbase64"
    with pytest.raises(LoginRequired, match="Could not decode the cookie"):
        parse_cookie_header(garbled)


def test_parse_duplicate_chunks(session_dict):
    value = encode_cookie_value(session_dict)
    header = f"{COOKIE_NAME}={value}; {COOKIE_NAME}={value}"
    session = parse_cookie_header(header)
    assert session.access_token == "access-1"
    assert session.user.username == "tester"


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


def test_store_corrupt_file(tmp_path):
    store = SessionStore(tmp_path / "session.json")
    store.path.write_text('{"nope": 1}')
    with pytest.raises(LoginRequired, match="The session file is unreadable"):
        store.load()


def test_store_default_path_uses_env(monkeypatch, tmp_path):
    monkeypatch.setenv("WM_CONFIG_DIR", str(tmp_path))
    assert SessionStore().path == tmp_path / "session.json"


def refresh_transport(status: int = 200, calls: list | None = None) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        if calls is not None:
            calls.append(request)
        if status != 200:
            return httpx.Response(status, json={"error_code": "refresh_token_not_found"})
        body = make_session_dict()
        body["access_token"] = "access-2"
        body["refresh_token"] = "refresh-2"
        return httpx.Response(200, json=body)

    return httpx.MockTransport(handler)


def test_anon_key_is_the_anon_role():
    payload = ANON_KEY.split(".")[1]
    decoded = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
    assert decoded["role"] == "anon"
    assert decoded["ref"] == auth.PROJECT_REF


def test_refresh_posts_token_and_returns_new_session(session_dict):
    calls: list[httpx.Request] = []
    http = httpx.Client(transport=refresh_transport(calls=calls))
    new = refresh(Session.model_validate(session_dict), http)
    assert new.access_token == "access-2"
    req = calls[0]
    assert str(req.url) == REFRESH_URL
    assert req.headers["apikey"] == ANON_KEY
    assert json.loads(req.content) == {"refresh_token": "refresh-1"}


def test_refresh_refused_raises_login_required(session_dict):
    http = httpx.Client(transport=refresh_transport(status=400))
    with pytest.raises(LoginRequired, match="Session expired"):
        refresh(Session.model_validate(session_dict), http)


def test_ensure_fresh_refreshes_near_expiry(tmp_path):
    store = SessionStore(tmp_path / "session.json")
    store.save(Session.model_validate(make_session_dict(expires_in_s=30)))
    http = httpx.Client(transport=refresh_transport())
    session = ensure_fresh(store, http)
    assert session.access_token == "access-2"
    assert store.load().refresh_token == "refresh-2"


def test_ensure_fresh_keeps_a_valid_session(tmp_path):
    store = SessionStore(tmp_path / "session.json")
    store.save(Session.model_validate(make_session_dict(expires_in_s=3600)))
    calls: list[httpx.Request] = []
    http = httpx.Client(transport=refresh_transport(calls=calls))
    assert ensure_fresh(store, http).access_token == "access-1"
    assert calls == []


def test_ensure_fresh_without_file(tmp_path):
    with pytest.raises(LoginRequired):
        ensure_fresh(SessionStore(tmp_path / "none.json"), httpx.Client(transport=refresh_transport()))


def test_refresh_server_error_raises_refresh_failed():
    http = httpx.Client(transport=refresh_transport(status=502))
    session = Session.model_validate(make_session_dict())
    with pytest.raises(RefreshFailed, match="HTTP 502"):
        refresh(session, http)


def test_refresh_invalid_response_body_raises_refresh_failed(session_dict):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"nope": 1})

    http = httpx.Client(transport=httpx.MockTransport(handler))
    with pytest.raises(RefreshFailed, match="unexpected answer from the auth service"):
        refresh(Session.model_validate(session_dict), http)


def test_ensure_fresh_at_boundary_60_does_not_refresh(tmp_path):
    now = 1000.0
    session_dict = make_session_dict()
    session_dict["expires_at"] = int(now + 60)
    store = SessionStore(tmp_path / "session.json")
    store.save(Session.model_validate(session_dict))
    calls: list[httpx.Request] = []
    http = httpx.Client(transport=refresh_transport(calls=calls))
    session = ensure_fresh(store, http, now=now)
    assert session.access_token == "access-1"
    assert calls == []


def test_ensure_fresh_at_boundary_59_does_refresh(tmp_path):
    now = 1000.0
    session_dict = make_session_dict()
    session_dict["expires_at"] = int(now + 59)
    store = SessionStore(tmp_path / "session.json")
    store.save(Session.model_validate(session_dict))
    http = httpx.Client(transport=refresh_transport())
    session = ensure_fresh(store, http, now=now)
    assert session.access_token == "access-2"
