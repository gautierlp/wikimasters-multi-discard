"""Pydantic models for the WikiMasters API and the Supabase session."""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field, field_validator


class Rarity(StrEnum):
    C = "C"
    PC = "PC"
    R = "R"
    SR = "SR"
    UR = "UR"
    L = "L"


class _Model(BaseModel):
    """Ignore fields we do not model, so a new site field never breaks the CLI."""

    model_config = ConfigDict(extra="ignore", populate_by_name=True)


class Card(_Model):
    id: str
    wikipedia_title: str
    wikipedia_url: str | None = None
    image_url: str | None = None
    hide_image: bool = False
    category: str | None = None
    lang: str | None = None
    rarity: Rarity | str
    atk: int | None = None
    def_: int | None = Field(default=None, alias="def")
    q_score: float | None = None
    pageviews: int | None = None
    created_at: datetime | None = None

    @field_validator("rarity", mode="before")
    @classmethod
    def validate_rarity(cls, v):
        if isinstance(v, str):
            try:
                return Rarity(v)
            except ValueError:
                return v
        return v


class UserCard(_Model):
    """One row of the collection: a card the player owns."""

    id: str
    card_id: str
    count: int = 1
    starred: bool = False
    is_shiny: bool = False
    tags: list[str] = Field(default_factory=list)
    obtained_at: datetime | None = None
    card: Card


class CollectionPage(_Model):
    total: int | None = None
    rarity_counts: dict[str, int] | None = Field(default=None, alias="rarityCounts")
    pending_trade_card_ids: list[str] = Field(default_factory=list, alias="pendingTradeCardIds")
    collection: list[UserCard] = Field(default_factory=list)


class ApiError(_Model):
    error: str | None = None
    message: str | None = None

    def text(self) -> str:
        return self.error or self.message or ""


class _KeepAll(BaseModel):
    """Keep unknown fields, so the session JSON round-trips through the cookie unchanged."""

    model_config = ConfigDict(extra="allow", populate_by_name=True)


class SessionUser(_KeepAll):
    id: str
    user_metadata: dict = Field(default_factory=dict)

    @property
    def username(self) -> str | None:
        name = self.user_metadata.get("username")
        return name if isinstance(name, str) else None


class Session(_KeepAll):
    access_token: str
    token_type: str = "bearer"
    expires_in: int | None = None
    expires_at: int
    refresh_token: str
    user: SessionUser | None = None
