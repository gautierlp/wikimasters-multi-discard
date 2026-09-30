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
    monkeypatch.setattr(main, "_client", lambda: Client(session, transport=httpx.MockTransport(wrapped)))
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
