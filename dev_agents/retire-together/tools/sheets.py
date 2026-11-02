"""sheets — 구글 시트 연결 (SHEET-01). 자산 데이터의 원천은 사용자의 구글 시트다 (docs/DECISIONS.md 2026-10-27).

구성 파일은 전부 data/local/google/ 아래 (git 제외):
  client_secret.json  사용자가 구글 클라우드에서 만든 OAuth 클라이언트 (데스크톱 앱)
  token.json          구글 로그인 뒤 받은 토큰 (자동 갱신)
  sheet.json          {"spreadsheet_id": ..., "url": ...}
시트 API만 쓴다(스코프 spreadsheets). 드라이브 목록은 읽지 않는다 — 기존 시트는 사용자가 URL을 붙여 넣는다.

테스트와 미연결 상태를 위해 같은 인터페이스의 메모리 구현(MemorySheets)을 둔다.
"""
from __future__ import annotations

import json
import re
import threading
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GOOGLE_DIR = ROOT / "data" / "local" / "google"
CLIENT_SECRET_PATH = GOOGLE_DIR / "client_secret.json"
TOKEN_PATH = GOOGLE_DIR / "token.json"
SHEET_PATH = GOOGLE_DIR / "sheet.json"
SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]
API = "https://sheets.googleapis.com/v4/spreadsheets"
SPREADSHEET_TITLE = "둘이서은퇴"

# 탭 이름과 열 — 앱과 시트가 같은 이름을 쓴다. 열 순서를 바꾸면 기존 시트를 못 읽으니 끝에만 추가한다.
ASSET_TAB = "자산"
ASSET_COLUMNS = ["id", "owner", "pocket", "assetClass", "name", "account", "account_id", "amount", "as_of", "source", "version", "updated_at", "request_id",
                 "parent_id", "valuation_source", "share_percent"]   # 뒤 3개: 세부 자산 연결·합산 기준·공동 지분(Codex UX-01 모델)
HOLDING_TAB = "보유종목"
HOLDING_COLUMNS = ["account_id", "ticker_name", "ticker", "qty", "price", "as_of", "updated_at", "buy_value"]
TABS = {ASSET_TAB: ASSET_COLUMNS, HOLDING_TAB: HOLDING_COLUMNS}

SPREADSHEET_ID_RE = re.compile(r"[-\w]{20,}")


class SheetsError(RuntimeError):
    """사용자에게 그대로 보여 줄 수 있는 연결·권한 오류."""


def _col_letter(n: int) -> str:
    s = ""
    while n:
        n, r = divmod(n - 1, 26)
        s = chr(65 + r) + s
    return s


def parse_spreadsheet_id(text: str) -> str:
    """시트 URL 또는 ID → ID. docs.google.com/spreadsheets/d/<id>/... 형식."""
    text = (text or "").strip()
    m = re.search(r"/spreadsheets/d/([-\w]+)", text)
    if m:
        return m.group(1)
    if SPREADSHEET_ID_RE.fullmatch(text):
        return text
    raise SheetsError("구글 시트 주소가 아니에요. 브라우저 주소창의 docs.google.com/spreadsheets/d/... 를 붙여 넣어 주세요.")


def _rows_to_dicts(header: list, values: list[list]) -> list[dict]:
    out = []
    for raw in values:
        if not any(str(c).strip() for c in raw):
            continue
        row = {h: (raw[i] if i < len(raw) else "") for i, h in enumerate(header)}
        out.append(row)
    return out


class MemorySheets:
    """시트 API 없이 같은 동작을 하는 메모리 구현 (테스트·드라이런)."""

    def __init__(self, tabs: dict[str, list[dict]] | None = None):
        self.tabs: dict[str, list[dict]] = {k: [dict(r) for r in v] for k, v in (tabs or {}).items()}
        self.spreadsheet_id = "memory"

    def ensure_tabs(self) -> None:
        for tab in TABS:
            self.tabs.setdefault(tab, [])

    def read(self, tab: str) -> list[dict]:
        return [dict(r) for r in self.tabs.get(tab, [])]

    def write(self, tab: str, rows: list[dict]) -> None:
        cols = TABS[tab]
        self.tabs[tab] = [{c: r.get(c, "") for c in cols} for r in rows]


class GoogleSheets:
    """구글 시트 v4 REST. 한 스프레드시트의 탭을 통째로 읽고 쓴다 (가구 데이터는 수십 행이라 충분)."""

    def __init__(self, session, spreadsheet_id: str):
        self.session = session
        self.spreadsheet_id = spreadsheet_id

    def _call(self, method: str, url: str, **kw):
        try:
            r = self.session.request(method, url, timeout=20, **kw)
        except Exception as e:  # 네트워크
            raise SheetsError(f"구글 시트에 연결할 수 없어요: {e}") from e
        if r.status_code == 404:
            raise SheetsError("시트를 찾을 수 없어요. 주소가 맞는지, 이 구글 계정에 공유됐는지 확인해 주세요.")
        if r.status_code in (401, 403):
            raise SheetsError("이 시트를 읽거나 쓸 권한이 없어요. 연결한 구글 계정으로 시트를 열 수 있는지 확인해 주세요.")
        if r.status_code >= 400:
            try:
                detail = r.json().get("error", {}).get("message", r.text)
            except Exception:
                detail = r.text
            raise SheetsError(f"구글 시트 오류: {detail[:200]}")
        return r.json() if r.content else {}

    def meta(self) -> dict:
        return self._call("GET", f"{API}/{self.spreadsheet_id}", params={"fields": "properties.title,spreadsheetUrl,sheets.properties.title"})

    def ensure_tabs(self) -> None:
        info = self.meta()
        existing = {s["properties"]["title"] for s in info.get("sheets", [])}
        requests_ = [{"addSheet": {"properties": {"title": t}}} for t in TABS if t not in existing]
        if requests_:
            self._call("POST", f"{API}/{self.spreadsheet_id}:batchUpdate", json={"requests": requests_})
        for tab, cols in TABS.items():
            got = self._call("GET", f"{API}/{self.spreadsheet_id}/values/{tab}!A1:{_col_letter(len(cols))}1")
            header = [str(h).strip() for h in (got.get("values") or [[]])[0]]
            if header[:len(cols)] == cols:
                continue
            if any(header) and header != cols[:len(header)]:   # 다른 머리글이 이미 있는 탭은 덮지 않는다 — 사용자 데이터일 수 있다
                raise SheetsError(f"'{tab}' 탭에 다른 머리글이 있어요. 탭 이름을 바꾸거나 1행을 {', '.join(cols)} 순서로 맞춰 주세요.")
            self._call("PUT", f"{API}/{self.spreadsheet_id}/values/{tab}!A1", params={"valueInputOption": "RAW"},
                       json={"values": [cols]})

    def read(self, tab: str) -> list[dict]:
        cols = TABS[tab]
        got = self._call("GET", f"{API}/{self.spreadsheet_id}/values/{tab}!A1:{_col_letter(len(cols))}",
                         params={"valueRenderOption": "UNFORMATTED_VALUE", "dateTimeRenderOption": "FORMATTED_STRING"})
        values = got.get("values") or []
        if not values:
            return []
        header = [str(h).strip() for h in values[0]]
        if header[:len(cols)] != cols and header != cols[:len(header)]:   # 옛 양식(열이 덜 있음)은 읽는다
            raise SheetsError(f"'{tab}' 탭의 머리글이 앱 양식과 달라요. 1행을 {', '.join(cols)} 순서로 맞춰 주세요.")
        return _rows_to_dicts(cols, values[1:])

    def write(self, tab: str, rows: list[dict]) -> None:
        cols = TABS[tab]
        values = [cols] + [[("" if r.get(c) is None else r.get(c)) for c in cols] for r in rows]
        last = _col_letter(len(cols))
        self._call("POST", f"{API}/{self.spreadsheet_id}/values/{tab}!A2:{last}:clear")
        self._call("PUT", f"{API}/{self.spreadsheet_id}/values/{tab}!A1:{last}{len(values)}",
                   params={"valueInputOption": "RAW"}, json={"values": values})


# ---------- 연결 상태 (파일) ----------

def save_client_secret(text: str) -> None:
    """구글 클라우드에서 받은 OAuth 클라이언트 JSON을 저장. 모양만 검사한다."""
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        raise SheetsError("JSON이 아니에요. 구글 클라우드에서 내려받은 client_secret_*.json 내용을 그대로 붙여 넣어 주세요.")
    key = "installed" if "installed" in data else "web" if "web" in data else None
    if key is None or not data[key].get("client_id") or not data[key].get("client_secret"):
        raise SheetsError("OAuth 클라이언트 JSON이 아니에요 ('installed' 또는 'web' 안에 client_id·client_secret이 있어야 해요).")
    GOOGLE_DIR.mkdir(parents=True, exist_ok=True, mode=0o700)
    CLIENT_SECRET_PATH.write_text(json.dumps(data), encoding="utf-8")
    CLIENT_SECRET_PATH.chmod(0o600)


def load_credentials():
    """저장된 토큰 → Credentials (만료면 갱신해 다시 저장). 없으면 None."""
    if not TOKEN_PATH.exists():
        return None
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials
    try:
        creds = Credentials.from_authorized_user_file(str(TOKEN_PATH), SCOPES)
    except (ValueError, KeyError):
        return None
    if creds.expired and creds.refresh_token:
        try:
            creds.refresh(Request())
            TOKEN_PATH.write_text(creds.to_json(), encoding="utf-8")
        except Exception:
            return None
    return creds if creds.valid else None


_flow_state: dict = {"running": False, "error": None}
_flow_lock = threading.Lock()


def connect_status() -> dict:
    return {"client_secret": CLIENT_SECRET_PATH.exists(), "connected": load_credentials() is not None,
            "connecting": _flow_state["running"], "connect_error": _flow_state["error"],
            "spreadsheet": load_sheet_config()}


def start_connect() -> None:
    """브라우저에서 구글 로그인·동의를 받는 흐름을 백그라운드 스레드로 시작. 끝나면 token.json이 생긴다."""
    if not CLIENT_SECRET_PATH.exists():
        raise SheetsError("먼저 OAuth 클라이언트 JSON을 저장해 주세요.")
    with _flow_lock:
        if _flow_state["running"]:
            return
        _flow_state.update(running=True, error=None)

    def run():
        try:
            from google_auth_oauthlib.flow import InstalledAppFlow
            flow = InstalledAppFlow.from_client_secrets_file(str(CLIENT_SECRET_PATH), SCOPES)
            creds = flow.run_local_server(host="127.0.0.1", port=0, open_browser=True,
                                          authorization_prompt_message="", success_message="연결됐어요. 이 창을 닫고 둘이서은퇴로 돌아가세요.")
            GOOGLE_DIR.mkdir(parents=True, exist_ok=True, mode=0o700)
            TOKEN_PATH.write_text(creds.to_json(), encoding="utf-8")
            TOKEN_PATH.chmod(0o600)
        except Exception as e:  # 사용자가 창을 닫거나 거부한 경우 포함
            _flow_state["error"] = f"구글 연결이 끝나지 않았어요: {e}"[:300]
        finally:
            _flow_state["running"] = False

    threading.Thread(target=run, name="google-oauth", daemon=True).start()


def disconnect() -> None:
    for p in (TOKEN_PATH, SHEET_PATH):
        if p.exists():
            p.unlink()


def load_sheet_config() -> dict | None:
    if not SHEET_PATH.exists():
        return None
    try:
        return json.loads(SHEET_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None


def save_sheet_config(spreadsheet_id: str, url: str, title: str) -> dict:
    GOOGLE_DIR.mkdir(parents=True, exist_ok=True, mode=0o700)
    cfg = {"spreadsheet_id": spreadsheet_id, "url": url, "title": title}
    SHEET_PATH.write_text(json.dumps(cfg, ensure_ascii=False), encoding="utf-8")
    return cfg


def _session():
    creds = load_credentials()
    if creds is None:
        raise SheetsError("구글 계정이 연결되지 않았어요. 설정에서 먼저 연결해 주세요.")
    from google.auth.transport.requests import AuthorizedSession
    return AuthorizedSession(creds)


def create_spreadsheet(title: str = SPREADSHEET_TITLE) -> dict:
    """새 시트를 만들고 탭·머리글을 채운 뒤 연결 정보를 저장."""
    session = _session()
    body = {"properties": {"title": title}, "sheets": [{"properties": {"title": t}} for t in TABS]}
    r = session.post(API, json=body, timeout=20)
    if r.status_code >= 400:
        raise SheetsError(f"시트를 만들지 못했어요: {r.text[:200]}")
    info = r.json()
    gs = GoogleSheets(session, info["spreadsheetId"])
    gs.ensure_tabs()
    return save_sheet_config(info["spreadsheetId"], info["spreadsheetUrl"], title)


def use_spreadsheet(url_or_id: str) -> dict:
    """사용자가 붙여 넣은 기존 시트를 쓴다. 탭이 없으면 만들고 머리글을 맞춘다."""
    sid = parse_spreadsheet_id(url_or_id)
    gs = GoogleSheets(_session(), sid)
    info = gs.meta()
    gs.ensure_tabs()
    return save_sheet_config(sid, info.get("spreadsheetUrl", f"https://docs.google.com/spreadsheets/d/{sid}"),
                             info.get("properties", {}).get("title", SPREADSHEET_TITLE))


def open_sheets() -> GoogleSheets | None:
    """연결·시트 지정이 다 됐으면 클라이언트, 아니면 None (앱은 로컬 저장소로 동작)."""
    cfg = load_sheet_config()
    if not cfg:
        return None
    creds = load_credentials()
    if creds is None:
        return None
    from google.auth.transport.requests import AuthorizedSession
    return GoogleSheets(AuthorizedSession(creds), cfg["spreadsheet_id"])


@dataclass
class SheetHealth:
    ok: bool
    detail: str
