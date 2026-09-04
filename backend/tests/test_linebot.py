from routers import linebot


def test_resolve_account_id_prefers_broker_account(monkeypatch):
    monkeypatch.setattr(linebot, "get_setting", lambda key: "fallback-account")
    broker = {"account_id": "broker-account"}
    assert linebot._resolve_account_id(broker) == "broker-account"


def test_resolve_account_id_falls_back_when_broker_has_no_account(monkeypatch):
    monkeypatch.setattr(linebot, "get_setting", lambda key: "fallback-account")
    broker = {"account_id": None}
    assert linebot._resolve_account_id(broker) == "fallback-account"


def test_resolve_account_id_falls_back_when_no_broker(monkeypatch):
    monkeypatch.setattr(linebot, "get_setting", lambda key: "fallback-account")
    assert linebot._resolve_account_id(None) == "fallback-account"


def test_resolve_account_id_none_when_nothing_configured(monkeypatch):
    monkeypatch.setattr(linebot, "get_setting", lambda key: None)
    assert linebot._resolve_account_id(None) is None
    assert linebot._resolve_account_id({"account_id": None}) is None
