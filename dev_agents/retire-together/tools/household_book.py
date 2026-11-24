"""가계부 계산 — 월 합계 기록에서 수입·쓴 돈·모은 돈·흐름을 만든다. 모든 금액은 원 단위 정수.

규칙: rules/household_book.yaml. 현금 주머니 = 수입 − 쓴 돈 − 연금 납입 − 대출 원금 (음수면 모아 둔 돈에서 꺼낸 달).
"""
from __future__ import annotations

import hashlib
import re
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


# ── 1년 표 (HB-02, 2026-11-20 사용자 시안 확정) ─────────────────────────────
# 칸 열쇠: income:me|partner|joint · spend:<항목 id> · big · saving:<id>. 표 한 줄 = 열쇠 하나.
INCOME_LABEL = {"me": "나", "partner": "배우자", "joint": "기타 (배당·이자)"}


def cell_keys(rules: dict) -> list[str]:
    return [f"income:{w}" for w in WHO] + [f"spend:{c}" for c in category_ids(rules)] + ["big"] + [f"saving:{s['id']}" for s in rules["saving"]]


def value_of(entry: dict, key: str) -> int:
    kind, _, k = key.partition(":")
    if kind == "income":
        return sum(l["net"] for l in entry.get("income", []) if l["who"] == k)
    if kind == "spend":
        return entry.get("spend", {}).get(k, 0)
    if kind == "saving":
        return entry.get("saving", {}).get(k, 0)
    return sum(b["amount"] for b in entry.get("big", []))


def editable(entry: dict, key: str) -> bool:
    """수입 줄·큰 지출이 여러 개면 칸 하나로 고칠 수 없다(합계만 보여 준다)."""
    if key.startswith("income:"):
        return sum(1 for l in entry.get("income", []) if l["who"] == key[7:]) <= 1
    if key == "big":
        return len(entry.get("big", [])) <= 1
    return True


def set_value(entry: dict, key: str, value: int) -> dict:
    """칸 하나를 바꾼 새 기록. 자동으로 채운 표시(auto)는 지운다."""
    if not editable(entry, key):
        raise ValueError("여러 줄이 합쳐진 칸이라 표에서 바로 고칠 수 없어요.")
    e = {**entry, "auto": [k for k in entry.get("auto", []) if k != key]}
    kind, _, k = key.partition(":")
    if kind == "income":
        old = next((l for l in entry.get("income", []) if l["who"] == k), None)
        line = {"who": k, "kind": old["kind"] if old else ("월급" if k != "joint" else "기타"), "label": old.get("label", "") if old else "",
                "gross": old["gross"] if old and old["net"] == value else None, "net": value}
        e["income"] = [l for l in entry.get("income", []) if l["who"] != k] + ([line] if value else [])
    elif kind in ("spend", "saving"):
        d = {**entry.get(kind, {}), k: value}
        e[kind] = {i: v for i, v in d.items() if v}
    else:
        name = entry["big"][0]["name"] if entry.get("big") else "큰 지출"
        e["big"] = [{"name": name, "amount": value}] if value else []
    return e


def prefill(prev: dict) -> dict:
    """새 달: 지난 기록에서 '매달 고정'으로 표시한 칸만 같은 금액으로 채운다. 채운 칸은 auto로 표시(화면에서 회색)."""
    fixed = list(prev.get("fixed") or [])
    e = {**empty_entry(), "fixed": fixed, "auto": [], "learned": {}, "seen": []}
    for key in fixed:
        if key.startswith("income:"):
            e["income"] += [l for l in prev.get("income", []) if l["who"] == key[7:]]
        elif value_of(prev, key):
            e = set_value(e, key, value_of(prev, key))
        if value_of(e, key):
            e["auto"].append(key)
    return e


def suggest_fixed(recent: list[dict], keys: list[str]) -> list[str]:
    """최근 3달(오래된 → 최근) 금액이 0 아닌 같은 값이고 아직 고정이 아닌 칸."""
    if len(recent) < 3:
        return []
    last3, fixed = recent[-3:], set(recent[-1].get("fixed") or [])
    return [k for k in keys if k != "big" and k not in fixed and value_of(last3[0], k) and len({value_of(e, k) for e in last3}) == 1]


def year_table(entries: dict[int, dict], rules: dict) -> list[dict]:
    """표의 줄: 묶음 합계·항목·남은 돈. values는 {월: 금액}, average는 적은(또는 미리 채운) 달 평균."""
    months = sorted(entries)
    sums = {m: month_summary(entries[m], rules) for m in months}
    avg = lambda vals: _avg([vals[m] for m in months])  # noqa: E731
    fixed = set(entries[months[-1]].get("fixed") or []) if months else set()
    rows = []

    def group(id_, label, vals):
        rows.append({"key": id_, "label": label, "kind": "group", "values": vals, "average": avg(vals)})

    def item(key, label):
        vals = {m: value_of(entries[m], key) for m in months}
        rows.append({"key": key, "label": label, "kind": "item", "fixed": key in fixed, "values": vals, "average": avg(vals),
                     "auto": [m for m in months if key in entries[m].get("auto", [])],
                     "locked": [m for m in months if not editable(entries[m], key)]})

    group("income", "수입", {m: sums[m]["income"] for m in months})
    for w in WHO:
        item(f"income:{w}", INCOME_LABEL[w])
    for g, grp in rules["spend"].items():
        group(g, grp["label"], {m: sums[m]["spend_groups"][g] for m in months})
        for it in grp["items"]:
            item(f"spend:{it['id']}", it["label"])
    item("big", rules["big_label"])
    rows[-1]["kind"] = "group-item"
    group("kept_saving", "모으고 갚은 돈", {m: sum(sums[m]["saving"].values()) for m in months})
    for s in rules["saving"]:
        item(f"saving:{s['id']}", s["label"])
    rows.append({"key": "cash", "label": "남은 돈 (현금 주머니)", "kind": "total", "values": {m: sums[m]["cash"] for m in months},
                 "average": avg({m: sums[m]["cash"] for m in months})})
    return rows


# ── 캡처 자동 분류 ───────────────────────────────────────────────────────
def merchant_key(name: str) -> str:
    return re.sub(r"\s+|\(주\)|㈜|주식회사", "", name or "").lower()


def classify(merchant: str, learned: dict[str, str], rules: dict) -> tuple[str | None, str | None]:
    """→ (분류, 근거). 사용자가 전에 고른 것 > 가맹점 낱말 규칙(가장 긴 낱말). 모르면 (None, None)."""
    key = merchant_key(merchant)
    if key in learned:
        return learned[key], "learned"
    hits = [(len(w), cid) for cid, words in rules.get("merchant_rules", {}).items() for w in words if merchant_key(w) in key]
    return (max(hits)[1], "rule") if hits else (None, None)


def tx_fingerprint(date: str, merchant: str, amount: int) -> str:
    return hashlib.sha256(f"{date}|{merchant_key(merchant)}|{amount}".encode()).hexdigest()[:16]


def apply_capture(entry: dict, rows: list[dict], rules: dict) -> tuple[dict, int]:
    """확인한 내역을 그달 항목 합계에 더한다. 이미 더한 내역(seen)은 건너뛴다. 고른 분류는 learned에 기억. → (새 기록, 더한 건수)"""
    cats = category_ids(rules)
    e = {**entry, "spend": dict(entry.get("spend", {})), "big": list(entry.get("big", [])),
         "learned": dict(entry.get("learned", {})), "seen": list(entry.get("seen", []))}
    seen, added = set(e["seen"]), 0
    for r in rows:
        fp = tx_fingerprint(r["date"], r["merchant"], r["amount"])
        if fp in seen:
            continue
        cat = r["category"]
        if cat in cats:
            e["spend"][cat] = e["spend"].get(cat, 0) + r["amount"]
        elif cat == "big":
            e["big"].append({"name": r["merchant"][:40], "amount": r["amount"]})
        elif cat != "skip":
            raise ValueError(f"모르는 분류예요: {cat}")
        if cat != "skip":
            added += 1
        e["learned"][merchant_key(r["merchant"])] = cat
        e["seen"].append(fp)
        seen.add(fp)
    e["auto"] = [k for k in entry.get("auto", []) if not (k.startswith("spend:") and k[6:] in {r["category"] for r in rows})]
    return e, added


def apply_payslips(entry: dict, slips: list[dict]) -> dict:
    """확인한 급여명세서를 그달 수입 줄로 넣는다. 같은 사람·같은 종류(월급/상여) 줄은 바꿔 넣는다. 미리 채운 표시는 지운다."""
    e = {**entry, "income": list(entry.get("income", [])), "auto": list(entry.get("auto", []))}
    for s in slips:
        line = {"who": s["who"], "kind": s["kind"], "label": s.get("label", ""), "gross": s.get("gross"), "net": s["net"],
                "deductions": dict(s.get("deductions") or {}), "pay_date": s.get("pay_date", "")}
        e["income"] = [l for l in e["income"] if not (l["who"] == s["who"] and l["kind"] == s["kind"])] + [line]
        e["auto"] = [k for k in e["auto"] if k != f"income:{s['who']}"]
    return e
