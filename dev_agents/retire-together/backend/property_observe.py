"""관측 원자료 보관 — 국토부 매매·전월세(모든 필드, 해제 포함)와 공개 호가 광고. 같은 거래가 나중에 바뀌면(해제·등기) 새 버전으로 남긴다.
최초 관측·마지막 관측 시각을 함께 둬 '그때 알 수 있었던 것'을 재현할 수 있게 한다(Codex 설계 PRIMARY_SOURCES_AND_CONCEPTS §6)."""
from __future__ import annotations

import hashlib
import json

import requests

from backend import storage
from backend import property as prop
from tools.property_observe import parse_items, rent_uid, trade_uid

URLS = {"trade": prop.TRADE_URLS[0], "rent": "https://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent"}
UID = {"trade": trade_uid, "rent": rent_uid}


def _table(conn):
    conn.execute("""CREATE TABLE IF NOT EXISTS property_obs (kind TEXT NOT NULL, uid TEXT NOT NULL, version TEXT NOT NULL, sgg TEXT NOT NULL, ym TEXT NOT NULL,
                    payload TEXT NOT NULL, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL, PRIMARY KEY (kind, uid, version))""")
    conn.execute("""CREATE TABLE IF NOT EXISTS property_obs_run (kind TEXT NOT NULL, scope TEXT NOT NULL, ym TEXT NOT NULL, fetched_at TEXT NOT NULL,
                    status TEXT NOT NULL, count INTEGER NOT NULL, detail TEXT NOT NULL DEFAULT '')""")
    conn.execute("""CREATE TABLE IF NOT EXISTS property_listing_obs (source TEXT NOT NULL, complex TEXT NOT NULL, listing_id TEXT NOT NULL, version TEXT NOT NULL,
                    payload TEXT NOT NULL, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL, PRIMARY KEY (source, complex, listing_id, version))""")


def _version(payload: dict) -> str:
    return hashlib.sha1(json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()[:16]


_POOL = None


def _get(url: str, params: dict, total_seconds: float = 60):
    """요청 전체에 벽시계 제한을 건다 — 서버가 조금씩 보내면 읽기 제한(timeout)이 계속 새로 시작돼 끝나지 않는 경우가 있었다(2026-11-08)."""
    global _POOL
    from concurrent.futures import ThreadPoolExecutor, TimeoutError as Late
    _POOL = _POOL or ThreadPoolExecutor(max_workers=4)
    future = _POOL.submit(requests.get, url, params=params, timeout=(10, 30))
    try:
        return future.result(timeout=total_seconds)
    except Late:
        raise requests.Timeout(f"{total_seconds:.0f}초 안에 응답을 다 받지 못했어요") from None


def _fetch(kind: str, sgg: str, ym: str) -> list[dict]:
    out, page = [], 1
    while True:
        r = _get(URLS[kind], {"serviceKey": prop.market_key(), "LAWD_CD": sgg, "DEAL_YMD": ym, "numOfRows": 1000, "pageNo": page})
        r.raise_for_status()
        items = parse_items(r.text)
        out += items
        total = int((r.text.split("<totalCount>")[1].split("<")[0]) if "<totalCount>" in r.text else len(out))
        if not items or len(out) >= total:
            return out
        page += 1


def collect_month(kind: str, sgg: str, ym: str) -> dict:
    """한 구·한 달 원자료를 받아 저장. 반환: {count, new, changed}."""
    now = storage.now()
    try:
        rows = _fetch(kind, sgg, ym)
    except (requests.RequestException, ValueError) as e:
        with storage.connection() as conn:
            _table(conn)
            conn.execute("INSERT INTO property_obs_run VALUES (?, ?, ?, ?, 'failed', 0, ?)", (kind, sgg, ym, now, str(e)[:200]))
        raise
    new = changed = 0
    with storage.connection() as conn:
        _table(conn)
        seen_in_month: dict[str, int] = {}
        for raw in rows:
            # 같은 날·층·면적·금액의 서로 다른 계약(다른 동 등)이 있다 — 한 달 응답 안에서 순번을 붙여 합치지 않는다.
            base = UID[kind](raw)
            seen_in_month[base] = seen_in_month.get(base, 0) + 1
            uid, ver = f"{base}#{seen_in_month[base]}", _version(raw)
            if conn.execute("SELECT 1 FROM property_obs WHERE kind=? AND uid=? AND version=?", (kind, uid, ver)).fetchone():
                conn.execute("UPDATE property_obs SET last_seen=? WHERE kind=? AND uid=? AND version=?", (now, kind, uid, ver))
                continue
            seen = conn.execute("SELECT 1 FROM property_obs WHERE kind=? AND uid=?", (kind, uid)).fetchone()
            new, changed = new + (not seen), changed + bool(seen)
            conn.execute("INSERT INTO property_obs VALUES (?, ?, ?, ?, ?, ?, ?, ?)", (kind, uid, ver, sgg, ym, json.dumps(raw, ensure_ascii=False), now, now))
        conn.execute("INSERT INTO property_obs_run VALUES (?, ?, ?, ?, 'ok', ?, '')", (kind, sgg, ym, now, len(rows)))
    return {"count": len(rows), "new": new, "changed": changed}


def latest(kind: str, sgg: str) -> list[dict]:
    """거래마다 가장 최근에 본 버전의 원자료(+first_seen)."""
    with storage.connection() as conn:
        _table(conn)
        rows = conn.execute("""SELECT uid, payload, first_seen, last_seen FROM property_obs o WHERE kind=? AND sgg=? AND last_seen =
                               (SELECT MAX(last_seen) FROM property_obs WHERE kind=o.kind AND uid=o.uid)""", (kind, sgg)).fetchall()
        firsts = dict(conn.execute("SELECT uid, MIN(first_seen) FROM property_obs WHERE kind=? AND sgg=? GROUP BY uid", (kind, sgg)).fetchall())
    return [{**json.loads(r["payload"]), "_uid": r["uid"], "_first_seen": firsts[r["uid"]]} for r in rows]


def save_listings(source: str, complex_key: str, listings: list[dict], complete: bool) -> dict:
    """한 단지의 광고 관측. 광고 ID별 버전(가격 등 변경 시 새 버전). 부분 관측이면 run에 표시해 이탈 계산에서 뺀다."""
    now, new, changed = storage.now(), 0, 0
    with storage.connection() as conn:
        _table(conn)
        for item in listings:
            ver = _version(item)
            key = (source, complex_key, str(item["id"]))
            if conn.execute("SELECT 1 FROM property_listing_obs WHERE source=? AND complex=? AND listing_id=? AND version=?", (*key, ver)).fetchone():
                conn.execute("UPDATE property_listing_obs SET last_seen=? WHERE source=? AND complex=? AND listing_id=? AND version=?", (now, *key, ver))
                continue
            seen = conn.execute("SELECT 1 FROM property_listing_obs WHERE source=? AND complex=? AND listing_id=?", key).fetchone()
            new, changed = new + (not seen), changed + bool(seen)
            conn.execute("INSERT INTO property_listing_obs VALUES (?, ?, ?, ?, ?, ?, ?)", (*key, ver, json.dumps(item, ensure_ascii=False), now, now))
        conn.execute("INSERT INTO property_obs_run VALUES (?, ?, ?, ?, ?, ?, '')", (f"listing:{source}", complex_key, now[:7], now, "ok" if complete else "partial", len(listings)))
    return {"count": len(listings), "new": new, "changed": changed, "complete": complete}


SEOUL_SGG = ["11110", "11140", "11170", "11200", "11215", "11230", "11260", "11290", "11305", "11320", "11350", "11380", "11410",
             "11440", "11470", "11500", "11530", "11545", "11560", "11590", "11620", "11650", "11680", "11710", "11740"]


def months(start: str, end: str) -> list[str]:
    """'202201'부터 'YYYYMM'까지(포함)."""
    y, m = int(start[:4]), int(start[4:])
    out = []
    while f"{y}{m:02d}" <= end:
        out.append(f"{y}{m:02d}")
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


def backfill(start: str, end: str, sggs: list[str] = SEOUL_SGG, kinds=("trade", "rent"), skip_done: bool = True) -> None:
    """과거 원자료 일괄 수집. 이미 성공한 (종류·구·월)은 건너뛴다. 실패는 기록하고 계속한다."""
    import sys, time
    with storage.connection() as conn:
        _table(conn)
        done = {(r["kind"], r["scope"], r["ym"]) for r in conn.execute("SELECT kind, scope, ym FROM property_obs_run WHERE status='ok'")}
    for kind in kinds:
        for sgg in sggs:
            for ym in months(start, end):
                if skip_done and (kind, sgg, ym) in done:
                    continue
                try:
                    r = collect_month(kind, sgg, ym)
                    print(kind, sgg, ym, r["count"], flush=True)
                except Exception as e:      # 한 달 실패가 전체를 멈추지 않게
                    print(kind, sgg, ym, "FAILED", str(e)[:120], file=sys.stderr, flush=True)
                time.sleep(0.2)


if __name__ == "__main__":
    import sys
    backfill(sys.argv[1], sys.argv[2])
