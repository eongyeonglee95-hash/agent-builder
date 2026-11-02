from datetime import date

from tools.decisions import read_decisions, record_decision


def test_record_then_read(tmp_path):
    p = tmp_path / "DECISIONS.md"
    p.write_text("# DECISIONS\n\n## 리밸런싱 제안 기록\n(아직 없음)\n", encoding="utf-8")
    record_decision("장기채 매수 보류", "금리 인하 기다림", on=date(2026, 7, 1), path=p)
    d = read_decisions(p)
    assert d == [{"date": "2026-07-01", "who": "사용자", "decision": "장기채 매수 보류", "reason": "금리 인하 기다림"}]
    assert "(아직 없음)" not in p.read_text(encoding="utf-8")


def test_save_accounts_roundtrip(tmp_path):
    from tools.assets import load_accounts_list, load_pools, save_accounts
    p = tmp_path / "accounts.yaml"
    accounts = [{"id": "a1", "label": "A", "owner": "me", "broker": "mirae", "account_type": "pension_savings",
                 "pocket": "pension", "layer": 3, "api": False, "active": True, "pool": "p1"}]
    pools = {"p1": {"label": "풀1", "strategy": "all_weather", "mode": "buy_only", "accounts": ["a1"]}}
    save_accounts(accounts, pools, path=p)
    assert load_accounts_list(p) == accounts
    got = load_pools(p)
    assert got["p1"]["mode"] == "buy_only" and got["p1"]["accounts"] == ["a1"]


def test_store_latest_per_account(tmp_path, monkeypatch):
    import datetime as dt
    import pandas as pd
    from tools import store
    monkeypatch.setattr(store, "SNAPSHOTS", tmp_path / "snap")
    monkeypatch.setattr(store, "SAMPLES", tmp_path / "samples")
    a = pd.DataFrame({"account_id": ["a"], "ticker_name": ["X"], "ticker": ["1"], "qty": [1], "price": [100]})
    store.save_holdings("a", a, on=dt.date(2026, 1, 1), accounts={"a": {}})
    a2 = a.assign(qty=[5])
    store.save_holdings("a", a2, on=dt.date(2026, 2, 1), accounts={"a": {}})
    df, src = store.load_holdings(["a", "b"])
    assert df["qty"].tolist() == [5] and src["b"] == "없음"


def test_upsert_asset_tags_and_pool_mode(tmp_path):
    import shutil
    from pathlib import Path
    from tools.assets import load_asset_map, load_pools, set_pool_mode, upsert_asset_tags
    root = Path(__file__).resolve().parents[1]
    amap = tmp_path / "asset_map.yaml"; shutil.copy(root / "rules" / "asset_map.yaml", amap)
    n = upsert_asset_tags([{"ticker_name": "새ETF", "ticker": "999999", "asset_class": "long_bond", "role": "core"}], path=amap)
    assert n == 1 and load_asset_map(amap)["새ETF"]["status"] == "confirmed"
    assert "class_defaults" in __import__("yaml").safe_load(amap.read_text(encoding="utf-8"))  # 기본 종목 보존
    acc = tmp_path / "accounts.yaml"; shutil.copy(root / "rules" / "accounts.yaml", acc)
    pid = set_pool_mode("me_mirae_pension_new", "rebalance", path=acc)
    assert load_pools(acc)[pid]["mode"] == "rebalance"
