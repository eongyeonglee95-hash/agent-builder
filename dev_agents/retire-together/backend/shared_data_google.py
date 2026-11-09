"""Append-only Sheets snapshots, atomic batch per operation, verified readback.

Sheets has no compare-and-swap for values. A hash of *all* preceding rows in each
append detects races with direct edits, including the check/write gap. Both
versions remain intact. Recovery appends a reviewed checkpoint; it never clears
or overwrites a tab. An ambiguous write is reconciled, never blindly retried.
"""
import json

from backend.shared_data_schema import encoded, fail, fingerprint
from tools.sheets import API, TABS

TAB = "공유자료_v1"
HEADER = ["operation_id", "parent_revision", "kind", "part", "parts", "payload_json"]


class Journal:
    def __init__(self, api, sid):
        self.api, self.sid = api, sid

    def meta(self):
        return self.api.call("GET", f"{API}/{self.sid}", params={"fields": "sheets(properties(sheetId,title))"})

    def raw(self):
        titles = {s["properties"]["title"] for s in self.meta().get("sheets", [])}
        if TAB not in titles:
            return []
        rows = self.api.call("GET", f"{API}/{self.sid}/values/'{TAB}'!A:F",
                             params={"valueRenderOption": "UNFORMATTED_VALUE"}).get("values", [])
        if not isinstance(rows, list) or len(rows) > 100000:
            fail()
        return rows

    def legacy(self):
        sheet = self.api.sheets(self.sid)
        return {tab: sheet.read(tab) for tab in TABS}

    def legacy_raw(self):
        # Full used grids retain extra columns/formulas for restoration evidence.
        return {tab: self.api.call("GET", f"{API}/{self.sid}/values/'{tab}'",
                params={"valueRenderOption": "FORMULA"}).get("values", []) for tab in TABS}

    def append(self, op, parent, kind, state):
        text = encoded(state)
        chunks = [text[i:i + 30000] for i in range(0, len(text), 30000)]
        values = [[op, parent, kind, str(i), str(len(chunks)), text] for i, text in enumerate(chunks)]
        meta = self.meta()
        tabs = {s["properties"]["title"]: s["properties"]["sheetId"] for s in meta.get("sheets", [])}
        requests = []
        if TAB not in tabs:
            used = set(tabs.values())
            tab_id = next(i for i in range(1700500, 1701000) if i not in used)
            requests.append({"addSheet": {"properties": {"sheetId": tab_id, "title": TAB}}})
            values = [HEADER, *values]
        else:
            tab_id = tabs[TAB]
            if not self.raw():
                values = [HEADER, *values]
        # stringValue prevents formula execution and preserves exact money in JSON.
        requests.append({"appendCells": {"sheetId": tab_id, "fields": "userEnteredValue", "rows": [
            {"values": [{"userEnteredValue": {"stringValue": cell}} for cell in row]} for row in values]}})
        self.api.call("POST", f"{API}/{self.sid}:batchUpdate", json={"requests": requests})


def events(raw):
    """Parse contiguous complete blocks. Returns raw offsets for race checking."""
    if not raw:
        return []
    # An explicit recovery acknowledges even malformed earlier rows by their
    # exact digest. Preserve them, but parse only the last recovery and its tail.
    recovery = next((i for i in range(len(raw)-1, 0, -1)
                     if isinstance(raw[i], list) and len(raw[i]) == 6
                     and raw[i][2] == "recovery" and str(raw[i][3]) == "0"), None)
    if recovery is None and raw[0] != HEADER:
        fail("공유 자료 머리글이 변경되었습니다. 백업·복구 확인이 필요합니다.")
    out, i = [], recovery or 1
    while i < len(raw):
        try:
            row = raw[i]
            op, parent, kind, part, count, text = row
            n = int(count)
            if str(part) != "0" or n < 1 or n > 100 or i + n > len(raw) or kind not in {"migration", "save", "recovery"}:
                fail()
            block = raw[i:i+n]
            for j, r in enumerate(block):
                if len(r) != 6 or r[:3] != row[:3] or str(r[3]) != str(j) or str(r[4]) != str(n) or not isinstance(r[5], str):
                    fail()
            state = json.loads("".join(r[5] for r in block))
        except (ValueError, TypeError, OverflowError):
            fail("공유 기록이 불완전합니다. 백업·복구 확인이 필요합니다.")
        out.append({"id": op, "parent": parent, "kind": kind, "state": state, "start": i, "end": i+n})
        i += n
    return out


def head(raw):
    parsed = events(raw)
    if not parsed:
        return None
    # A recovery checkpoint acknowledges the raw history, including a prior fork.
    last_recovery = max((i for i, e in enumerate(parsed) if e["kind"] == "recovery"), default=0)
    ids = set()
    for e in parsed[last_recovery:]:
        prefix = raw[:e["start"]]
        if e["start"] == 1 and raw[0] == HEADER and e["parent"] == fingerprint([]):
            prefix = []  # The header and first operation were created atomically.
        if e["parent"] != fingerprint(prefix) or e["id"] in ids:
            fail("공유 시트가 저장 중 변경되었습니다. 두 버전을 보존했으니 복구 대조표를 확인해 주세요.")
        ids.add(e["id"])
    return parsed[-1]["state"]
