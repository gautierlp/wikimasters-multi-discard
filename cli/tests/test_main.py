import base64
import json

import httpx
import pytest
from typer.testing import CliRunner

from wikimasters import main
from wikimasters.auth import COOKIE_NAME, RefreshFailed, SessionStore
from wikimasters.client import Client
from wikimasters.main import app
from wikimasters.models import Session

from .conftest import make_session_dict

runner = CliRunner()


def cookie_text(data: dict) -> str:
    raw = base64.urlsafe_b64encode(json.dumps(data).encode()).decode().rstrip("=")
    return f"{COOKIE_NAME}=base64-{raw}"


@pytest.fixture(autouse=True)
def config_dir(monkeypatch, tmp_path):
    monkeypatch.setenv("WM_CONFIG_DIR", str(tmp_path))
    return tmp_path


def fake_client(monkeypatch, handler) -> list[httpx.Request]:
    """Make main._client() return a Client on a fake network, and record requests."""
    calls: list[httpx.Request] = []

    def wrapped(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return handler(request)

    session = Session.model_validate(make_session_dict())
    monkeypatch.setattr(main, "_client", lambda: Client(session, transport=httpx.MockTransport(wrapped), sleep=lambda s: None))
    return calls


def test_login_from_stdin(config_dir):
    result = runner.invoke(app, ["login"], input=cookie_text(make_session_dict()))
    assert result.exit_code == 0, result.output
    assert "Logged in as tester" in result.output
    assert SessionStore().load().access_token == "access-1"


def test_login_from_file(tmp_path):
    path = tmp_path / "cookie.txt"
    path.write_text(cookie_text(make_session_dict()))
    result = runner.invoke(app, ["login", "--from-file", str(path)])
    assert result.exit_code == 0, result.output
    assert "Logged in as tester" in result.output


def test_login_bad_text():
    result = runner.invoke(app, ["login"], input="nothing useful")
    assert result.exit_code == 1
    assert "Could not read the cookie" in result.output


def test_commands_need_a_session():
    result = runner.invoke(app, ["collection"])
    assert result.exit_code == 1
    assert "Not logged in. Run `wm login`." in result.output


def test_collection_table(monkeypatch, page_json):
    fake_client(monkeypatch, lambda r: httpx.Response(200, json=page_json))
    result = runner.invoke(app, ["collection"])
    assert result.exit_code == 0, result.output
    lines = result.output.splitlines()
    assert any(line.startswith("uc-1") and "Alpha" in line and " R " in line for line in lines)
    assert any(line.startswith("uc-2") and "*" in line for line in lines)  # starred
    assert any(line.startswith("uc-3") and "T" in line for line in lines)  # pending trade
    assert lines[-1] == "3 of 3 cards"


def test_collection_page_and_rarity_filter(monkeypatch, page_json):
    calls = fake_client(monkeypatch, lambda r: httpx.Response(200, json=page_json))
    result = runner.invoke(app, ["collection", "--page", "4", "--rarity", "sr"])
    assert result.exit_code == 0, result.output
    assert dict(calls[0].url.params) == {"sort": "rarity", "page": "4", "stats": "1"}
    assert "Beta" in result.output and "Alpha" not in result.output
    assert result.output.splitlines()[-1] == "1 cards"


def test_collection_json(monkeypatch, page_json):
    fake_client(monkeypatch, lambda r: httpx.Response(200, json=page_json))
    result = runner.invoke(app, ["collection", "--json"])
    assert result.exit_code == 0, result.output
    rows = json.loads(result.output)
    assert [r["id"] for r in rows] == ["uc-1", "uc-2", "uc-3"]
    assert rows[0]["card"]["def"] == 12


def test_collection_expired_session(monkeypatch):
    fake_client(monkeypatch, lambda r: httpx.Response(401, json={"error": "Unauthorized"}))
    result = runner.invoke(app, ["collection"])
    assert result.exit_code == 1
    assert "Session expired. Run `wm login` again." in result.output


def test_collection_refresh_failed(monkeypatch):
    def boom():
        raise RefreshFailed("Could not refresh the session (HTTP 502). Try again later.")

    monkeypatch.setattr(main, "_client", boom)
    result = runner.invoke(app, ["collection"])
    assert result.exit_code == 1
    assert "Could not refresh the session (HTTP 502). Try again later." in result.output


def test_collection_network_error(monkeypatch):
    def handler(request):
        raise httpx.ConnectError("boom")

    fake_client(monkeypatch, handler)
    result = runner.invoke(app, ["collection"])
    assert result.exit_code == 1
    assert "Network error" in result.output


def collection_then_discard(page_json, discard_status: int = 200):
    """A fake site: GET pages return the fixture, POST discards answer discard_status."""

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            if discard_status == 200:
                return httpx.Response(200, json={"ok": True})
            return httpx.Response(discard_status, json={"error": "Vous ne possédez plus cette carte"})
        return httpx.Response(200, json=page_json)

    return handler


def posted_ids(calls: list[httpx.Request]) -> list[str]:
    return [c.url.path.split("/")[3] for c in calls if c.method == "POST"]


def test_discard_refuses_starred_pending_and_unknown(monkeypatch, page_json):
    calls = fake_client(monkeypatch, collection_then_discard(page_json))
    result = runner.invoke(app, ["discard", "uc-2", "uc-3", "uc-9", "--yes"])
    assert result.exit_code == 1
    assert "uc-2: starred (Beta)" in result.output
    assert "uc-3: in a pending trade (Gamma)" in result.output
    assert "uc-9: not in your collection" in result.output
    assert posted_ids(calls) == []


def test_discard_asks_and_aborts_on_no(monkeypatch, page_json):
    calls = fake_client(monkeypatch, collection_then_discard(page_json))
    result = runner.invoke(app, ["discard", "uc-1"], input="n\n")
    assert result.exit_code == 1
    assert "Discard 1 card(s)?" in result.output
    assert "Aborted." in result.output
    assert posted_ids(calls) == []


def test_discard_with_yes_posts_each_id_once(monkeypatch, page_json):
    calls = fake_client(monkeypatch, collection_then_discard(page_json))
    result = runner.invoke(app, ["discard", "uc-1", "uc-1", "-y"])
    assert result.exit_code == 0, result.output
    assert "ok Alpha" in result.output
    assert posted_ids(calls) == ["uc-1"]


def test_discard_stops_at_first_failure(monkeypatch, page_json):
    page_json["collection"][1]["starred"] = False
    page_json["pendingTradeCardIds"] = []
    calls = fake_client(monkeypatch, collection_then_discard(page_json, discard_status=409))
    result = runner.invoke(app, ["discard", "uc-1", "uc-2", "uc-3", "-y"])
    assert result.exit_code == 1
    assert "failed Alpha: HTTP 409: Vous ne possédez plus cette carte" in result.output
    assert posted_ids(calls) == ["uc-1"]


def test_pending_matches_catalog_card_id(monkeypatch, page_json):
    page_json["pendingTradeCardIds"] = ["card-3"]
    calls = fake_client(monkeypatch, collection_then_discard(page_json))
    listing = runner.invoke(app, ["collection"])
    assert any(line.startswith("uc-3") and "T" in line for line in listing.output.splitlines())
    result = runner.invoke(app, ["discard", "uc-3", "-y"])
    assert result.exit_code == 1
    assert "uc-3: in a pending trade (Gamma)" in result.output
    assert posted_ids(calls) == []


def test_collection_html_answer_is_clean(monkeypatch):
    fake_client(monkeypatch, lambda r: httpx.Response(200, text="<html>maintenance</html>"))
    result = runner.invoke(app, ["collection"])
    assert result.exit_code == 1
    assert "Unexpected answer from the site" in result.output


def test_login_missing_file():
    result = runner.invoke(app, ["login", "--from-file", "/nonexistent/cookie.txt"])
    assert result.exit_code == 2
    assert "does not exist" in result.output or "/nonexistent/cookie.txt" in result.output


def test_discard_5xx_names_the_card(monkeypatch, page_json):
    def handler(request):
        if request.method == "POST":
            return httpx.Response(502, text="bad gateway")
        return httpx.Response(200, json=page_json)

    fake_client(monkeypatch, handler)
    result = runner.invoke(app, ["discard", "uc-1", "-y"])
    assert result.exit_code == 1
    assert "failed Alpha:" in result.output


def test_discard_rechecks_after_confirmation(monkeypatch, page_json):
    import copy

    changed = copy.deepcopy(page_json)
    changed["collection"][0]["starred"] = True
    gets = []

    def handler(request):
        if request.method == "POST":
            return httpx.Response(200, json={"ok": True})
        gets.append(request)
        return httpx.Response(200, json=page_json if len(gets) == 1 else changed)

    calls = fake_client(monkeypatch, handler)
    result = runner.invoke(app, ["discard", "uc-1", "-y"])
    assert result.exit_code == 1
    assert "uc-1: starred (Alpha)" in result.output
    assert posted_ids(calls) == []


def test_discard_fetches_collection_twice(monkeypatch, page_json):
    calls = fake_client(monkeypatch, collection_then_discard(page_json))
    result = runner.invoke(app, ["discard", "uc-1", "-y"])
    assert result.exit_code == 0, result.output
    assert len([c for c in calls if c.method == "GET"]) == 2
