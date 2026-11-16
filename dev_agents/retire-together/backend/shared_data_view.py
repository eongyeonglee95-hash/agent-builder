"""Read-only dashboard projection. Fixed ownership is never rewritten on login."""
from backend.storage import AssetInput, scoped_asset


def dashboard(state, viewer, scope):
    records, members = state["records"], state["members"]
    original = {v: k for k, v in members.items()}
    viewer_alias = {viewer["me"]: "me", viewer["partner"]: "partner"}
    canonical_scope = "together" if scope == "together" else original[viewer[scope]]
    rows = []
    for r in records:
        if r["kind"] != "asset":
            continue
        p = r["payload"]
        who = "joint" if r["member_id"] == "joint" else original[r["member_id"]]
        base = {k: v for k, v in p.items() if k not in {"account_id", "source", "updated_at", "version", "request_id"}}
        rows.append({**AssetInput(**base, owner=who).model_dump(mode="json"), **p, "owner": who, "id": r["id"]})

    def display(row):
        out = dict(row)
        if row["owner"] != "joint":
            out["owner"] = viewer_alias[members[row["owner"]]]
        elif viewer["me"] != members["me"]:
            out["share_percent"] = 100 - row["share_percent"]
        if out.get("scoped_owner"):
            out["scoped_owner"] = scope
        return out

    effective, groups = [], []
    roots = [r for r in rows if not r.get("parent_id")]
    for root in roots:
        scoped = scoped_asset(root, canonical_scope)
        if scoped is None:
            continue
        children = [r for r in rows if r.get("parent_id") == root["id"]]
        effective.extend(display(r) for r in (children if root["valuation_source"] == "details" and children else [scoped]))
        if root["pocket"] in {"retirement", "cash"}:
            total = sum(c["amount"] for c in children)
            groups.append({"account": display(root), "details": [display(c) for c in children],
                           "source": root["valuation_source"], "details_total": total, "difference": total - root["amount"]})
    assets = [r for r in effective if r["pocket"] != "debt"]
    debts = [r for r in effective if r["pocket"] == "debt"]
    total, debt = sum(r["amount"] for r in assets), sum(r["amount"] for r in debts)
    retirement = sum(r["amount"] for r in assets if r["pocket"] == "retirement")
    cash = sum(r["amount"] for r in assets if r["pocket"] == "cash")
    people = {r["member_id"]: r["payload"] for r in records if r["kind"] == "profile"}
    goal = next((r["payload"] for r in records if r["kind"] == "family_goal"), {})
    family = {"me": people.get(viewer["me"], {"name": "나", "age": None, "gender": "unspecified", "role": None}),
              "partner": people.get(viewer["partner"]), "version": 0, "updated_at": "",
              "retirement_age": goal.get("retirement_age"), "target_amount": goal.get("target_amount"),
              "goal_person": people.get(members["me"]), "goal_reference_label": "나" if viewer["me"] == members["me"] else "배우자"}
    snapshot = {"assets": assets, "debts": debts, "total": total, "debt": debt, "net": total - debt,
                "retirement": retirement, "cash": cash, "financial": retirement + cash,
                "property": sum(r["amount"] for r in assets if r["pocket"] == "property"),
                "count": sum(scoped_asset(r, canonical_scope) is not None for r in roots),
                "unclassified": sum(r["amount"] for r in assets if r["assetClass"] == "mixed"),
                "as_of": min((r["as_of"] for r in effective), default=None), "account_groups": groups,
                "partner_missing": viewer["partner"] not in people, "goal_missing": not goal}
    return {"family": family, "snapshot": snapshot}
