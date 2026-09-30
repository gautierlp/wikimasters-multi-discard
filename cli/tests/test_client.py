
import httpx
import pytest

from wikimasters.auth import COOKIE_NAME
from wikimasters.client import PAGE_SIZE, RETRIES, RETRY_WAIT_S, ApiRefused, Client
from wikimasters.models import Session

from .conftest import make_session_dict


def make_row(i: int, **overrides) -> dict:
    row = {
        "id": f"uc-{i}",
        "card_id": f"card-{i}",
        "count": 1,
        "starred": False,
        "is_shiny": False,
        "tags": [],
        "card": {"id": f"card-{i}", "wikipedia_title": f"Title {i}", "rarity": "R"},
    }
    row.update(overrides)
    return row


def make_page(rows: list[dict], pending: list[str] = (), total: int | None = None) -> dict:
    return {
        "total": total,
        "rarityCounts": {"R": len(rows)} if total is not None else {},
        "tagOptions": [],
        "pendingTradeCardIds": list(pending),
        "collection": rows,
    }


@pytest.fixture
def session() -> Session:
    return Session.model_validate(make_session_dict())


def client_with(handler, session: Session, sleep=lambda s: None) -> tuple[Client, list[httpx.Request]]:
    calls: list[httpx.Request] = []

    def wrapped(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return handler(request)

    return Client(session, transport=httpx.MockTransport(wrapped), sleep=sleep), calls


def test_collection_page_sends_cookie_and_params(session, page_json):
    client, calls = client_with(lambda r: httpx.Response(200, json=page_json), session)
    page = client.collection_page(2, stats=True)
    assert [r.id for r in page.collection] == ["uc-1", "uc-2", "uc-3"]
    req = calls[0]
    assert req.url.path == "/api/my-collection"
    assert dict(req.url.params) == {"sort": "rarity", "page": "2", "stats": "1"}
    assert req.headers["cookie"].startswith(f"{COOKIE_NAME}=base64-")
    assert "Mozilla" in req.headers["user-agent"]


def test_all_collection_walks_until_short_page(session):
    pages = {
        0: make_page([make_row(i) for i in range(PAGE_SIZE)], pending=["uc-1"], total=52),
        1: make_page([make_row(50), make_row(51)], pending=["uc-51"]),
    }

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=pages[int(request.url.params["page"])])

    client, calls = client_with(handler, session)
    page = client.all_collection()
    assert len(page.collection) == 52
    assert page.total == 52
    assert page.rarity_counts == {"R": 50}
    assert page.pending_trade_card_ids == ["uc-1", "uc-51"]
    assert [c.url.params["stats"] for c in calls] == ["1", "0"]


def test_all_collection_stops_at_max_pages(session, monkeypatch):
    monkeypatch.setattr("wikimasters.client.MAX_PAGES", 3)
    full = make_page([make_row(i) for i in range(PAGE_SIZE)])
    client, _ = client_with(lambda r: httpx.Response(200, json=full), session)
    with pytest.raises(RuntimeError, match="more than 3 pages"):
        client.all_collection()


def test_discard_posts_empty_body(session):
    client, calls = client_with(lambda r: httpx.Response(200, json={"ok": True}), session)
    client.discard("uc-1")
    req = calls[0]
    assert req.method == "POST"
    assert req.url.path == "/api/user-cards/uc-1/discard"
    assert req.content == b""


def test_discard_refusal_maps_to_api_refused(session):
    client, _ = client_with(lambda r: httpx.Response(409, json={"error": "Vous ne possédez plus cette carte"}), session)
    with pytest.raises(ApiRefused) as info:
        client.discard("uc-1")
    assert info.value.status == 409
    assert info.value.message == "Vous ne possédez plus cette carte"
    assert str(info.value) == "HTTP 409: Vous ne possédez plus cette carte"


def test_refusal_with_plain_text_body(session):
    client, _ = client_with(lambda r: httpx.Response(401, text="Unauthorized"), session)
    with pytest.raises(ApiRefused, match="HTTP 401: Unauthorized"):
        client.collection_page(0)


def test_server_error_raises_httpx_error(session):
    client, _ = client_with(lambda r: httpx.Response(502, text="bad gateway"), session)
    with pytest.raises(httpx.HTTPStatusError):
        client.collection_page(0)


def test_collection_page_retries_server_errors_then_succeeds(session, page_json):
    answers = iter([500, 500, 200])
    sleeps: list[float] = []

    def handler(request: httpx.Request) -> httpx.Response:
        status = next(answers)
        return httpx.Response(status, json=page_json) if status == 200 else httpx.Response(status)

    client, calls = client_with(handler, session, sleep=sleeps.append)
    page = client.collection_page(0)
    assert len(page.collection) == 3
    assert len(calls) == 3
    assert sleeps == [1.0, 2.0]


def test_collection_page_gives_up_after_retries(session):
    sleeps: list[float] = []
    client, calls = client_with(lambda r: httpx.Response(500), session, sleep=sleeps.append)
    with pytest.raises(httpx.HTTPStatusError):
        client.collection_page(0)
    assert len(calls) == RETRIES == 3
    assert sleeps == [RETRY_WAIT_S, RETRY_WAIT_S * 2]


def test_collection_page_retries_transport_errors(session, page_json):
    attempts = []

    def handler(request: httpx.Request) -> httpx.Response:
        attempts.append(1)
        if len(attempts) == 1:
            raise httpx.ConnectError("reset", request=request)
        return httpx.Response(200, json=page_json)

    sleeps: list[float] = []
    client, calls = client_with(handler, session, sleep=sleeps.append)
    assert len(client.collection_page(0).collection) == 3
    assert sleeps == [1.0]


def test_collection_page_does_not_retry_4xx(session):
    sleeps: list[float] = []
    client, calls = client_with(lambda r: httpx.Response(409, json={"error": "non"}), session, sleep=sleeps.append)
    with pytest.raises(ApiRefused):
        client.collection_page(0)
    assert len(calls) == 1
    assert sleeps == []


def test_discard_is_not_retried_on_server_error(session):
    sleeps: list[float] = []
    client, calls = client_with(lambda r: httpx.Response(502), session, sleep=sleeps.append)
    with pytest.raises(httpx.HTTPStatusError):
        client.discard("uc-1")
    assert len(calls) == 1
    assert sleeps == []
