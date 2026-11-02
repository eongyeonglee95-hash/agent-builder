from pathlib import Path
import yaml

ROOT = Path(__file__).resolve().parents[1]


def test_strategy_targets_sum_to_100():
    data = yaml.safe_load((ROOT / "rules" / "strategies.yaml").read_text(encoding="utf-8"))
    aw = data["strategies"]["all_weather"]["targets"]
    assert abs(sum(aw.values()) - 100) < 1e-9


def test_accounts_have_required_fields():
    data = yaml.safe_load((ROOT / "rules" / "accounts.yaml").read_text(encoding="utf-8"))
    ids = set()
    for a in data["accounts"]:
        for k in ("id", "owner", "broker", "account_type", "pocket", "active"):
            assert k in a, f"{a.get('id')} missing {k}"
        assert a["id"] not in ids, f"duplicate id {a['id']}"
        ids.add(a["id"])
    assert any(a["active"] for a in data["accounts"]), "PoC 대상 계좌가 하나는 있어야 함"
