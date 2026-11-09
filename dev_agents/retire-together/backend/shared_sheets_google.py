"""Narrow drive.file adapter. No Drive-wide search, public sharing or auto-retry."""
import re
import time

from fastapi import HTTPException
import requests

from backend.auth_google import TOKEN_URL
from tools.sheets import API, GoogleSheets, SheetsError, TABS, _col_letter, _rows_to_dicts

FILE_SCOPE = "https://www.googleapis.com/auth/drive.file"
ALLOWED_SCOPES = {FILE_SCOPE, "openid", "email", "profile",
                  "https://www.googleapis.com/auth/userinfo.email", "https://www.googleapis.com/auth/userinfo.profile"}
DRIVE = "https://www.googleapis.com/drive/v3/files"
MIME = "application/vnd.google-apps.spreadsheet"
FIELDS = "id,name,mimeType,trashed,ownedByMe,capabilities(canEdit),appProperties"
ID_RE = re.compile(r"[A-Za-z0-9_-]{20,200}")


class CreateRejected(HTTPException):
    """Google definitively rejected this create; a later explicit retry is safe."""


def file_id(value: str) -> str:
    if not isinstance(value, str) or not ID_RE.fullmatch(value):
        raise HTTPException(422, "파일 선택창에서 고른 Google 시트 ID가 필요합니다.")
    return value


def token_values(data: dict, *, require_scope: bool = True) -> tuple[str, str, float]:
    try:
        access, refresh = data["access_token"], data.get("refresh_token", "")
        expiry = int(data["expires_in"])
        scopes = set(data.get("scope", "").split())
        if (not isinstance(access, str) or not 1 <= len(access) <= 16384
                or not isinstance(refresh, str) or len(refresh) > 16384 or not 0 < expiry <= 86400
                or data.get("token_type", "").lower() != "bearer"
                or ((require_scope or "scope" in data) and (FILE_SCOPE not in scopes or not scopes <= ALLOWED_SCOPES))):
            raise ValueError
        return access, refresh, time.time() + expiry
    except (KeyError, ValueError, TypeError, AttributeError, OverflowError):
        raise HTTPException(409, "선택한 파일 접근 권한에 다시 동의해 주세요.") from None


class GoogleFiles:
    def __init__(self, config, store, user_id: str):
        self.config, self.store, self.user_id = config, store, user_id

    def _token(self) -> str:
        # Refresh and save under a short DB write transaction so concurrent reads
        # cannot lose a rotated refresh token. No token is returned to the caller.
        with self.store.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            grant = db.execute("SELECT * FROM sheet_grants WHERE user_id=?", (self.user_id,)).fetchone()
            if grant is None:
                raise HTTPException(409, "공통 시트 접근에 Google 동의가 필요합니다.")
            if grant["expires_at"] > time.time() + 60:
                return grant["access_token"]
            if not grant["refresh_token"]:
                raise HTTPException(409, "Google 시트 연결이 만료되었습니다. 다시 동의해 주세요.")
            try:
                response = requests.post(TOKEN_URL, data={"client_id": self.config.client_id,
                    "client_secret": self.config.client_secret, "grant_type": "refresh_token",
                    "refresh_token": grant["refresh_token"]}, timeout=10, allow_redirects=False)
                if response.status_code != 200:
                    raise HTTPException(503 if response.status_code >= 500 or response.status_code == 429 else 409,
                                        "Google 시트 연결을 갱신할 수 없습니다. 잠시 후 재시도하거나 다시 동의해 주세요.")
                access, refresh, expires = token_values(response.json(), require_scope=False)
            except (requests.RequestException, ValueError):
                raise HTTPException(503, "Google 연결이 불안정합니다. 잠시 후 다시 시도해 주세요.") from None
            db.execute("UPDATE sheet_grants SET access_token=?,refresh_token=?,expires_at=? WHERE user_id=?",
                       (access, refresh or grant["refresh_token"], expires, self.user_id))
            return access

    def request(self, method, url, **kwargs):
        # GoogleSheets calls this transport too. No redirects (credential leakage),
        # no provider response bodies or exception strings in user-visible errors.
        try:
            response = requests.request(method, url, headers={"Authorization": "Bearer " + self._token()},
                                        allow_redirects=False, **kwargs)
        except requests.RequestException:
            raise HTTPException(503, "Google 연결이 불안정합니다. 기존 파일 연결은 유지됩니다.") from None
        if method == "POST" and url == DRIVE and response.status_code in {400, 401, 403, 404, 429}:
            raise CreateRejected(409, "Google이 시트 생성을 거부했습니다. API 설정·권한 또는 요청 한도를 확인하고 다시 시도해 주세요.")
        if response.status_code in (401, 403):
            raise HTTPException(409, "파일 접근 권한을 확인하거나 Google에 다시 동의해 주세요. 기존 연결은 유지됩니다.")
        if response.status_code == 404:
            raise HTTPException(409, "연결된 시트를 찾을 수 없습니다. 삭제·권한 상태를 확인해 주세요. 새 시트는 만들지 않았습니다.")
        if not 200 <= response.status_code < 300:
            raise HTTPException(503, "Google 요청을 완료하지 못했습니다. 기존 연결은 유지됩니다.")
        return response

    def call(self, method, url, **kwargs) -> dict:
        try:
            data = self.request(method, url, timeout=20, **kwargs).json()
            if not isinstance(data, dict):
                raise ValueError
            return data
        except ValueError:
            raise HTTPException(503, "Google 파일 응답을 확인할 수 없습니다.") from None

    def owned(self, sid: str) -> dict:
        meta = self.call("GET", f"{DRIVE}/{file_id(sid)}", params={"fields": FIELDS})
        if (meta.get("id") != sid or meta.get("mimeType") != MIME or meta.get("trashed") is not False
                or meta.get("ownedByMe") is not True or meta.get("capabilities", {}).get("canEdit") is not True):
            raise HTTPException(409, "고정 오너가 소유하고 편집할 수 있는 Google 시트만 연결할 수 있습니다.")
        return meta

    def create(self, operation_id: str) -> str:
        meta = self.call("POST", DRIVE, params={"fields": "id"}, json={"name": "둘이서은퇴", "mimeType": MIME,
                         "appProperties": {"retire_operation": operation_id}})
        return file_id(meta.get("id"))

    def recover(self, operation_id: str) -> str:
        # The marker is our own UUID, never a user query or financial data.
        result = self.call("GET", DRIVE, params={"q": "appProperties has { key='retire_operation' and value='"
                           + operation_id + "' }", "fields": "files(id),nextPageToken,incompleteSearch", "pageSize": 2})
        files = result.get("files", [])
        if len(files) != 1 or result.get("nextPageToken") or result.get("incompleteSearch"):
            raise HTTPException(409, "이전 생성 결과를 확인 중입니다. 중복 방지를 위해 새 파일을 만들지 않습니다. 잠시 후 재시도해 주세요.")
        return file_id(files[0].get("id"))

    def sheets(self, sid: str):
        return SharedGoogleSheets(self, sid)

    def prepare(self, sid: str):
        try:
            self.sheets(sid).ensure_tabs()
        except SheetsError:
            raise HTTPException(409, "시트 양식을 확인해 주세요. 기존 파일 연결은 유지됩니다.") from None

    def validate(self, sid: str):
        # Selecting an existing file must never add tabs, headers or migrate rows.
        sheet = self.sheets(sid)
        try:
            titles = {s["properties"]["title"] for s in sheet.meta().get("sheets", [])}
            if not set(TABS) <= titles:
                raise SheetsError("missing tabs")
            for tab in TABS:
                sheet.read(tab, header_only=True)
        except (SheetsError, KeyError, TypeError):
            raise HTTPException(409, "기존 시트의 자산·보유종목 탭과 머리글을 확인해 주세요. 자료는 변경하지 않았습니다.") from None


class SharedGoogleSheets(GoogleSheets):
    def _call(self, method, url, **kwargs):
        return self.session.call(method, url, **kwargs)

    def read(self, tab, *, header_only=False):
        # An empty tab is not a valid shared ledger. The legacy reader treats it
        # as zero assets, which could bind an unusable file or hide deleted headers.
        cols = TABS[tab]
        end = _col_letter(len(cols)) + ("1" if header_only else "")
        got = self._call("GET", f"{API}/{self.spreadsheet_id}/values/{tab}!A1:{end}",
                         params={"valueRenderOption": "UNFORMATTED_VALUE", "dateTimeRenderOption": "FORMATTED_STRING"})
        values = got.get("values")
        if not isinstance(values, list) or not values or any(not isinstance(row, list) for row in values):
            raise SheetsError("공통 시트의 탭과 머리글을 확인해 주세요. 기존 파일 연결은 유지됩니다.")
        header = [str(cell).strip() for cell in values[0]]
        # Preserve the legacy reader's support for older, shorter column lists.
        if not any(header) or (header[:len(cols)] != cols and header != cols[:len(header)]):
            raise SheetsError("공통 시트의 머리글이 앱 양식과 다릅니다. 기존 파일 연결은 유지됩니다.")
        return _rows_to_dicts(cols, values[1:])

    def write(self, tab, rows):
        # Legacy SheetStore clears a whole tab on writes. SHARE-05 must replace
        # this with serialized/versioned shared writes before enabling editing.
        raise HTTPException(409, "공통 시트의 자료 이전·동시 저장 연결 전에는 앱에서 읽기만 가능합니다.")
