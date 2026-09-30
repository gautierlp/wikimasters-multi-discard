"""The `wm` command line."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Callable, TypeVar

import httpx
import typer

from .auth import LoginRequired, RefreshFailed, SessionStore, ensure_fresh, parse_cookie_header
from .client import ApiRefused, Client
from .models import CollectionPage, UserCard

T = TypeVar("T")

app = typer.Typer(help="WikiMasters from the terminal.", no_args_is_help=True)


@app.callback()
def _root() -> None:
    """WikiMasters from the terminal."""


def _fail(message: str, code: int = 1) -> None:
    typer.echo(message, err=True)
    raise typer.Exit(code)


def _client() -> Client:
    """A client on a fresh session. Tests replace this function."""
    try:
        session = ensure_fresh(SessionStore(), httpx.Client(timeout=30))
    except (LoginRequired, RefreshFailed) as err:
        _fail(str(err))
    except httpx.HTTPError as err:
        _fail(f"Network error: {err}")
    return Client(session)


def _api_message(err: ApiRefused) -> str:
    if err.status == 401:
        return "Session expired. Run `wm login` again."
    return str(err)


def _call(fn: Callable[[], T]) -> T:
    """Run an API call, turning refusals and network failures into a clean exit."""
    try:
        return fn()
    except RefreshFailed as err:
        _fail(str(err))
    except ApiRefused as err:
        _fail(_api_message(err))
    except httpx.HTTPError as err:
        _fail(f"Network error: {err}")


@app.command()
def login(
    from_file: Path | None = typer.Option(None, "--from-file", help="Read the Cookie header from this file."),
) -> None:
    """Store the browser session from a pasted Cookie header (or a copied curl command)."""
    if from_file is not None:
        text = from_file.read_text()
    elif sys.stdin.isatty():
        _fail("Pipe the cookie in: `pbpaste | wm login`, or use `--from-file`.", 2)
    else:
        text = sys.stdin.read()
    try:
        session = parse_cookie_header(text)
    except (LoginRequired, ValueError) as err:
        _fail(f"Could not read the cookie: {err}")
    SessionStore().save(session)
    user = session.user
    who = (user.username or user.id) if user else "unknown user"
    typer.echo(f"Logged in as {who}")


def _print_rows(rows: list[UserCard], pending: set[str], total: int | None) -> None:
    for row in rows:
        flags = ("*" if row.starred else " ") + ("T" if row.id in pending else " ")
        typer.echo(f"{row.id:36}  {row.card.rarity:3}  {row.count:>3}  {flags}  {row.card.wikipedia_title}")
    if total is not None:
        typer.echo(f"{len(rows)} of {total} cards")
    else:
        typer.echo(f"{len(rows)} cards")


@app.command()
def collection(
    page: int | None = typer.Option(None, "--page", help="One page only (0-based)."),
    rarity: str | None = typer.Option(None, "--rarity", help="Keep only this rarity: C, PC, R, SR, UR, L."),
    as_json: bool = typer.Option(False, "--json", help="Print the rows as JSON."),
) -> None:
    """List your collection."""

    def fetch() -> CollectionPage:
        client = _client()
        return client.collection_page(page, stats=True) if page is not None else client.all_collection()

    data = _call(fetch)
    rows = data.collection
    if rarity:
        rows = [row for row in rows if str(row.card.rarity).upper() == rarity.upper()]
    if as_json:
        typer.echo(json.dumps([row.model_dump(by_alias=True, mode="json") for row in rows], ensure_ascii=False, indent=2))
        return
    _print_rows(rows, set(data.pending_trade_card_ids), data.total)
