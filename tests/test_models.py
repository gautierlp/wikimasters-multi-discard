from wikimasters.models import ApiError, CollectionPage, Rarity, Session, UserCard


def test_fixture_page_validates(page_json):
    page = CollectionPage.model_validate(page_json)
    assert page.total == 3
    assert page.rarity_counts["SR"] == 1
    assert page.pending_trade_card_ids == ["uc-3"]
    assert [r.id for r in page.collection] == ["uc-1", "uc-2", "uc-3"]


def test_nulls_are_accepted(page_json):
    page = CollectionPage.model_validate(page_json)
    beta = page.collection[1]
    assert beta.card.image_url is None
    assert beta.card.category is None
    assert beta.starred is True
    assert beta.card.def_ == 22


def test_stats_zero_page_has_no_total():
    page = CollectionPage.model_validate(
        {"total": None, "rarityCounts": {}, "tagOptions": [], "pendingTradeCardIds": [], "collection": []}
    )
    assert page.total is None
    assert page.rarity_counts == {}


def test_known_and_unknown_rarity(page_json):
    row = page_json["collection"][0]
    assert UserCard.model_validate(row).card.rarity is Rarity.R
    row["card"]["rarity"] = "XX"
    assert UserCard.model_validate(row).card.rarity == "XX"


def test_unknown_fields_are_ignored(page_json):
    page_json["surprise"] = 1
    page_json["collection"][0]["card"]["surprise"] = 1
    CollectionPage.model_validate(page_json)


def test_session_round_trips_unknown_fields(session_dict):
    session_dict["provider_token"] = "keep-me"
    session = Session.model_validate(session_dict)
    assert session.user.username == "tester"
    assert session.model_dump()["provider_token"] == "keep-me"


def test_api_error_text():
    assert ApiError.model_validate({"error": "nope"}).text() == "nope"
    assert ApiError.model_validate({"message": "msg"}).text() == "msg"
    assert ApiError.model_validate({}).text() == ""
