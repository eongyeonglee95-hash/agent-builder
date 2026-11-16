"""Only user/writer permissions on the already-bound owner file.

Never transfer ownership, notify by email, or remove pre-existing/ambiguous
permissions. Drive has no idempotency key for permission creation; a lost reply
is reconciled by reads and is reported for manual cleanup, never re-POSTed.
"""
import re

from fastapi import HTTPException

from backend.household_invites_store import email_key
from backend.shared_sheets_google import DRIVE, FIELDS, MIME, GoogleFiles, file_id

PERMISSION_FIELDS = "id,type,role,emailAddress,deleted,permissionDetails,expirationTime"


class SharingGoogle(GoogleFiles):
    def permissions(self, sid):
        result, page, seen = [], None, set()
        for _ in range(100):
            data = self.call("GET", f"{DRIVE}/{file_id(sid)}/permissions", params={
                "fields": f"nextPageToken,permissions({PERMISSION_FIELDS})", "pageSize": 100,
                **({"pageToken": page} if page else {})})
            permissions = data.get("permissions")
            if not isinstance(permissions, list) or any(not isinstance(p, dict) or not isinstance(p.get("id"), str) for p in permissions):
                raise HTTPException(503, "Google 공유 권한 응답을 확인할 수 없습니다.")
            result.extend(p for p in permissions if not p.get("deleted"))
            page = data.get("nextPageToken")
            if not page:
                return result
            if not isinstance(page, str) or page in seen:
                break
            seen.add(page)
        raise HTTPException(503, "Google 공유 권한 목록을 모두 확인하지 못했습니다.")

    def create_permission(self, sid, email):
        permission = self.call("POST", f"{DRIVE}/{file_id(sid)}/permissions",
            params={"fields": PERMISSION_FIELDS, "sendNotificationEmail": "false"},
            json={"type": "user", "role": "writer", "emailAddress": email})
        if not valid_writer(permission, email):
            raise HTTPException(503, "Google 공유 생성 결과를 확인하지 못했습니다. 상태 확인 후 재개해 주세요.")
        return permission

    def delete_permission(self, sid, permission_id):
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,200}", permission_id):
            raise HTTPException(409, "공유 권한 식별자를 확인할 수 없습니다.")
        # DELETE may return 204; do not parse an empty body. A missing permission
        # is confirmed by a subsequent complete list, not a generic file 404.
        self.request("DELETE", f"{DRIVE}/{file_id(sid)}/permissions/{permission_id}", timeout=20)

    def accessible(self, sid):
        meta = self.call("GET", f"{DRIVE}/{file_id(sid)}", params={"fields": FIELDS})
        if (meta.get("id") != sid or meta.get("mimeType") != MIME or meta.get("trashed") is not False
                or meta.get("capabilities", {}).get("canEdit") is not True):
            raise HTTPException(409, "배우자 계정의 공통 시트 편집 접근을 확인해 주세요.")
        self.validate(sid)


def matches(permission, email):
    return permission.get("type") == "user" and str(permission.get("emailAddress", "")).lower() == email_key(email)


def valid_writer(permission, email):
    return (isinstance(permission, dict) and isinstance(permission.get("id"), str)
            and re.fullmatch(r"[A-Za-z0-9_-]{1,200}", permission["id"]) is not None
            and matches(permission, email) and permission.get("role") == "writer"
            and not permission.get("deleted") and not permission.get("expirationTime"))


def inherited(permission):
    return any(detail.get("inherited") for detail in permission.get("permissionDetails", []))


def ensure_shared(store, invitation, api):
    sid, email, iid = invitation["spreadsheet_id"], invitation["email"], invitation["id"]
    api.owned(sid)
    permissions = api.permissions(sid)
    matching = [p for p in permissions if matches(p, email)]
    if matching:
        if len(matching) != 1 or not valid_writer(matching[0], email):
            raise HTTPException(409, "기존 배우자 공유 권한을 Google Drive에서 편집자로 확인해 주세요.")
        permission = matching[0]
        source = invitation["permission_source"]
        if permission["id"] != invitation["permission_id"]:
            source = "uncertain" if invitation["permission_attempt"] else "existing"
        store.update_permission(iid, permission_id=permission["id"], source=source,
                                attempt=invitation["permission_attempt"])
        return
    if invitation["permission_attempt"] or invitation["permission_id"]:
        raise HTTPException(409, "이전 공유 결과를 확인 중입니다. 중복 공유 없이 같은 초대로 재개하거나 취소해 주세요.")
    api._token()  # No durable send reservation until credentials are available.
    store.update_permission(iid, attempt=1)
    try:
        permission = api.create_permission(sid, email)
    except HTTPException as exc:
        if exc.status_code == 409:  # Definite Google refusal or token failure.
            store.update_permission(iid)
        raise
    store.update_permission(iid, permission_id=permission["id"], source="created", attempt=1)
    # Confirm visibility independently; response alone is not membership readiness.
    if not any(p["id"] == permission["id"] and valid_writer(p, email) for p in api.permissions(sid)):
        raise HTTPException(409, "Google 공유 반영을 확인 중입니다. 같은 초대에서 다시 확인해 주세요.")


def cleanup_share(store, invitation, api):
    iid, sid = invitation["id"], invitation["spreadsheet_id"]
    if not invitation["permission_attempt"] and not invitation["permission_id"]:
        store.cleanup_result(iid, "done", False)
        return
    api.owned(sid)
    permissions = api.permissions(sid)
    owned = next((p for p in permissions if p["id"] == invitation["permission_id"]), None)
    if invitation["permission_attempt"] and not invitation["permission_id"]:
        # A lost create reply may first become visible during cancellation.
        # Remember the ID without claiming provenance or deleting it.
        matching = [p for p in permissions if matches(p, invitation["email"])]
        if len(matching) == 1:
            owned = matching[0]
            store.update_permission(iid, permission_id=owned["id"], source="uncertain", attempt=1)
            invitation = store.get(iid)
    if owned and invitation["permission_source"] == "created":
        if not valid_writer(owned, invitation["email"]) or inherited(owned):
            store.cleanup_result(iid, "attention", True)
            return
        api.delete_permission(sid, owned["id"])
        permissions = api.permissions(sid)
        if any(p["id"] == owned["id"] for p in permissions):
            raise HTTPException(409, "앱 공유 권한 삭제 반영을 다시 확인해 주세요.")
    residual = any(matches(p, invitation["email"]) or p.get("type") in {"anyone", "domain", "group"}
                   for p in permissions)
    # An uncertain create with no visible result cannot be declared cleaned up:
    # Google may still apply the request. Owner must inspect the file later.
    uncertain = ((invitation["permission_source"] == "uncertain" and owned is not None)
                 or (invitation["permission_attempt"] and not invitation["permission_id"]))
    store.cleanup_result(iid, "attention" if uncertain else "done", residual or uncertain)
