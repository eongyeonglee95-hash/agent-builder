"""가계부 계산 — 월 합계 기록에서 수입·쓴 돈·모은 돈·흐름을 만든다. 모든 금액은 원 단위 정수.

규칙: rules/household_book.yaml. 현금 주머니 = 수입 − 쓴 돈 − 연금 납입 − 대출 원금 (음수면 모아 둔 돈에서 꺼낸 달).
"""
from __future__ import annotations

from pathlib import Path

import yaml

RULES_PATH = Path(__file__).resolve().parents[1] / "rules" / "household_book.yaml"
WHO = ("me", "partner", "joint")


def load_rules(path: Path | None = None) -> dict:
    return yaml.safe_load((path or RULES_PATH).read_text(encoding="utf-8"))


def category_ids(rules: dict) -> dict[str, str]:
    """{항목 id: 묶음 id(fixed/life)}"""
    return {item["id"]: group for group, g in rules["spend"].items() for item in g["items"]}


def empty_entry() -> dict:
    return {"income": [], "spend": {}, "big": [], "saving": {}}


def month_summary(entry: dict, rules: dict) -> dict:
    cats = category_ids(rules)
    by_who = {w: 0 for w in WHO}
    for line in entry.get("income", []):
        by_who[line["who"]] += line["net"]
    income = sum(by_who.values())
    groups = {g: 0 for g in rules["spend"]}
    for cid, amount in entry.get("spend", {}).items():
        groups[cats[cid]] += amount
    big = sum(b["amount"] for b in entry.get("big", []))
    spend = sum(groups.values()) + big
    saving = {s["id"]: entry.get("saving", {}).get(s["id"], 0) for s in rules["saving"]}
    cash = income - spend - sum(saving.values())
    kept = sum(saving.values()) + cash
    return {
        "income": income, "income_by_who": by_who,
        "spend": spend, "spend_groups": {**groups, "big": big},
        "saving": saving, "cash": cash, "kept": kept,
        "kept_rate": round(kept / income * 100, 1) if income else None,
    }


def flow(summary: dict, rules: dict) -> dict:
    """흐름 그림 재료: 왼쪽 수입원 → 오른쪽 쓰임. 0원 갈래는 뺀다. 현금 주머니가 음수면 오른쪽에서 빼고 따로 알린다."""
    who_label = {"me": "나", "partner": "배우자", "joint": "기타 (배당·이자)"}
    sources = [{"id": w, "label": who_label[w], "amount": v} for w, v in summary["income_by_who"].items() if v > 0]
    g = summary["spend_groups"]
    uses = [{"id": k, "label": rules["spend"][k]["label"], "amount": g[k], "kind": "spend"} for k in rules["spend"]]
    uses.append({"id": "big", "label": rules["big_label"], "amount": g["big"], "kind": "spend"})
    uses += [{"id": s["id"], "label": s["label"], "amount": summary["saving"][s["id"]], "kind": "saving"} for s in rules["saving"]]
    uses.append({"id": "cash", "label": "현금 주머니", "amount": max(summary["cash"], 0), "kind": "saving"})
    income = summary["income"]
    uses = [{**u, "share": round(u["amount"] / income * 100, 1) if income else None} for u in uses if u["amount"] > 0]
    return {"sources": sources, "uses": uses,
            "shortfall": -summary["cash"] if summary["cash"] < 0 else 0}


def _avg(values: list[int]) -> int | None:
    return round(sum(values) / len(values)) if values else None


def year_view(entries: dict[int, dict], rules: dict) -> dict:
    """entries: {월(1~12): 기록}. 적은 달만 평균에 넣는다."""
    months = {m: month_summary(e, rules) for m, e in sorted(entries.items())}
    keys = ("income", "spend", "cash", "kept")
    total = {k: sum(s[k] for s in months.values()) for k in keys}
    total["income_by_who"] = {w: sum(s["income_by_who"][w] for s in months.values()) for w in WHO}
    total["spend_groups"] = {g: sum(s["spend_groups"][g] for s in months.values()) for g in [*rules["spend"], "big"]}
    total["saving"] = {s["id"]: sum(x["saving"][s["id"]] for x in months.values()) for s in rules["saving"]}
    total["kept_rate"] = round(total["kept"] / total["income"] * 100, 1) if total["income"] else None
    average = {k: _avg([s[k] for s in months.values()]) for k in keys}
    cat_total = {cid: sum(e.get("spend", {}).get(cid, 0) for e in entries.values()) for cid in category_ids(rules)}
    cat_avg = {cid: _avg([e.get("spend", {}).get(cid, 0) for e in entries.values()]) for cid in category_ids(rules)}
    group_avg = {g: _avg([s["spend_groups"][g] for s in months.values()]) for g in [*rules["spend"], "big"]}
    return {"months": months, "recorded": len(months), "total": total, "average": average,
            "category_average": cat_avg, "category_total": cat_total, "group_average": group_avg,
            "flow": flow(total, rules) if months else None}


def compare_month(entry: dict, view: dict, rules: dict) -> list[dict]:
    """그달 항목별 금액과 올해 월평균 차이. over: 평균보다 규칙 비율 넘게 많음."""
    ratio = rules["over_average_ratio"]
    out = []
    for group, g in rules["spend"].items():
        for item in g["items"]:
            value = entry.get("spend", {}).get(item["id"], 0)
            avg = view["category_average"].get(item["id"])
            out.append({"id": item["id"], "group": group, "label": item["label"], "amount": value, "average": avg,
                        "diff": None if avg is None else value - avg,
                        "over": avg is not None and avg > 0 and value > avg * (1 + ratio)})
    return out
