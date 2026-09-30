"""HTTP client for the two WikiMasters endpoints the CLI uses."""

from __future__ import annotations

import time
from collections.abc import Callable

import httpx

from .auth import build_cookie_header
from .models import ApiError, CollectionPage, Session

BASE_URL = "https://www.wiki-masters.com"
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36"
)
PAGE_SIZE = 50
MAX_PAGES = 200
RETRIES = 3  # total attempts for a page load
RETRY_WAIT_S = 1.0  # wait after attempt n is RETRY_WAIT_S * n
# Same waits as the extension's queue.js. A 500 on a discard has so far always
# left the card in place, and a later try discards it without a problem.
DISCARD_RETRY_WAITS_S = [2.0, 5.0, 10.0]


class ApiRefused(Exception):
    """The site answered 4xx. `message` is the server's own text, often French."""

    def __init__(self, status: int, message: str) -> None:
        self.status = status
        self.message = message
        super().__init__(f"HTTP {status}: {message}" if message else f"HTTP {status}")


class Client:
    def __init__(
        self,
        session: Session,
        transport: httpx.BaseTransport | None = None,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self._sleep = sleep
        self._http = httpx.Client(
            base_url=BASE_URL,
            transport=transport,
            timeout=30,
            headers={
                "user-agent": USER_AGENT,
                "accept": "*/*",
                "cookie": build_cookie_header(session),
            },
        )

    def close(self) -> None:
        self._http.close()

    def collection_page(self, page: int, stats: bool = False) -> CollectionPage:
        params = {"sort": "rarity", "page": page, "stats": int(stats)}
        waits = [RETRY_WAIT_S * n for n in range(1, RETRIES)]
        response = self._with_retries(lambda: self._http.get("/api/my-collection", params=params), waits)
        return CollectionPage.model_validate(response.json())

    def all_collection(self) -> CollectionPage:
        """Every row, in the site's order. Stops at the first page shorter than PAGE_SIZE."""
        first = self.collection_page(0, stats=True)
        rows = list(first.collection)
        pending = set(first.pending_trade_card_ids)
        last = first
        page = 1
        while len(last.collection) >= PAGE_SIZE:
            if page >= MAX_PAGES:
                raise RuntimeError(f"Collection has more than {MAX_PAGES} pages; stopped to avoid an endless loop")
            last = self.collection_page(page)
            rows.extend(last.collection)
            pending.update(last.pending_trade_card_ids)
            page += 1
        return CollectionPage(
            total=first.total,
            rarity_counts=first.rarity_counts,
            pending_trade_card_ids=sorted(pending),
            collection=rows,
        )

    def discard(self, user_card_id: str) -> None:
        self._with_retries(lambda: self._http.post(f"/api/user-cards/{user_card_id}/discard"), DISCARD_RETRY_WAITS_S)

    def _with_retries(self, send: Callable[[], httpx.Response], waits: list[float]) -> httpx.Response:
        """Send, and send again after each wait on a 5xx or a transport error. A 4xx is final."""
        for wait in [*waits, None]:
            try:
                response = send()
            except httpx.TransportError:
                if wait is None:
                    raise
            else:
                if response.status_code < 500 or wait is None:
                    _raise_for(response)
                    return response
            self._sleep(wait)


def _raise_for(response: httpx.Response) -> None:
    if response.is_success:
        return
    if 400 <= response.status_code < 500:
        try:
            message = ApiError.model_validate(response.json()).text()
        except ValueError:
            message = ""
        if not message:
            message = response.text.strip()[:150]
        raise ApiRefused(response.status_code, message)
    response.raise_for_status()
