"""SHARE-04 owner-managed invitations and resumable, verified partner admission."""
import hmac
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse, RedirectResponse
from pydantic import Field

from backend import auth_google
from backend.auth_store import FLOW_SECONDS, SESSION_SECONDS
from backend.household_invites_google import SharingGoogle, cleanup_share, ensure_shared, matches
from backend.household_invites_store import InviteStore, JOIN_SECONDS, TERMINAL
from backend.shared_sheets import enabled, public_binding
from backend.shared_sheets_google import token_values
from backend.storage import InputModel

router = APIRouter(prefix="/api/auth/invitations", tags=["household-invitations"])
PUBLIC = {"/api/auth/invitations/accept", "/api/auth/invitations/join",
          "/api/auth/invitations/resume", "/api/auth/invitations/picker"}


def context(request, *, owner=False):
    from backend.auth import web_context
    config, _ = web_context(request)
    store = InviteStore(config.db_path)
    if owner:
        store.owner(request.state.identity)
    return config, store


def view(row):
    return {k: row[k] for k in ("id", "email", "status", "expires_at", "cleanup", "residual_access")}


def same_origin(request, config):
    if (request.headers.get("origin") != config.origin
            or request.headers.get("x-retire-invite") != "1"):
        raise HTTPException(403, "앱에서 초대 수락을 다시 시작해 주세요.")


def join_context(request, *, write=False):
    from backend.auth import csrf_token
    config, store = context(request)
    token = request.cookies.get(config.flow_cookie + "_join", "")
    if not 20 <= len(token) <= 128:
        raise HTTPException(401, "초대 본인 확인이 필요합니다.")
    row = store.join(token)
    if write:
        same_origin(request, config)
        supplied = request.headers.get("x-retire-csrf", "")
        if not hmac.compare_digest(supplied.encode(), csrf_token(token).encode()):
            raise HTTPException(403, "초대 요청 확인에 실패했습니다.")
    return config, store, row, token


class Invitation(InputModel):
    email: Annotated[str, Field(min_length=3, max_length=320)]


class Acceptance(InputModel):
    code: Annotated[str, Field(min_length=43, max_length=43, pattern=r"^[A-Za-z0-9_-]+$")]


@router.post("")
def issue(data: Invitation, request: Request):
    config, store = context(request, owner=True)
    with store.operation():
        row, code = store.issue(request.state.identity, data.email)
    # Fragment keeps the secret out of access logs/referrers. SHARE-06 consumes
    # and clears it before POSTing the code; no automatic email is sent.
    return {"invitation": view(row), "code": code, "url": config.origin + "/#invite=" + code}


@router.get("")
def invitations(request: Request):
    _, store = context(request, owner=True)
    store.expire()
    with store.connection() as db:
        rows = db.execute("SELECT * FROM household_invites ORDER BY created_at DESC LIMIT 50").fetchall()
    return {"invitations": [view(row) for row in rows]}


@router.post("/accept")
def accept(data: Acceptance, request: Request):
    from backend.auth import cookie
    config, store = context(request)
    same_origin(request, config)
    enabled()
    state, browser, nonce, verifier = store.new_invite_flow(data.code, request.cookies.get(config.flow_cookie + "_invite", ""))
    response = JSONResponse({"authorization_url": auth_google.authorization_url(config, state, nonce, verifier, files=True)})
    cookie(response, config, config.flow_cookie + "_invite", browser, FLOW_SECONDS)
    return response


def advance(config, store, token, previous_session):
    enabled()
    with store.operation():
        row = store.join(token)
        binding = store.binding(row["household_id"])
        if not binding or not binding["ready"] or binding["spreadsheet_id"] != row["spreadsheet_id"]:
            raise HTTPException(409, "초대에 연결된 공통 시트를 확인해 주세요.")
        ensure_shared(store, row, SharingGoogle(config, store, row["owner_user_id"]))
        # Both app membership and partner's own file grant are required; owner's
        # successful read must never substitute for the partner's consent/Picker.
        SharingGoogle(config, store, row["user_id"]).accessible(row["spreadsheet_id"])
        return store.activate(token, previous_session)


def callback(request):
    from backend.auth import clear_cookie, cookie
    config, store = context(request)
    join_token, session = None, None
    try:
        enabled()
        params = request.query_params
        if len(params.getlist("state")) != 1 or not 20 <= len(params["state"]) <= 128:
            raise HTTPException(400, "초대 본인 확인 요청이 일치하지 않습니다.")
        flow = store.consume_invite_flow(params["state"], request.cookies.get(config.flow_cookie + "_invite", ""))
        if "error" in params or len(params.getlist("code")) != 1 or not 1 <= len(params["code"]) <= 4096:
            raise HTTPException(400, "초대 본인 확인이 취소되었거나 응답이 올바르지 않습니다.")
        sub, email, tokens = auth_google.exchange_verified(config, params["code"], flow["nonce"], flow["verifier"])
        join_token = store.identify(flow["invite_id"], sub, email, token_values(tokens))
        session = advance(config, store, join_token, request.cookies.get(config.session_cookie, ""))
        response = RedirectResponse(config.origin + "/?invitation=ready", status_code=303)
    except HTTPException as exc:
        if join_token or "text/html" in request.headers.get("accept", ""):
            reason = ("pending" if join_token else "cancelled" if request.query_params.get("error") == "access_denied"
                      else "target" if exc.status_code == 403 else "expired" if exc.status_code in {409, 410} else "failed")
            response = RedirectResponse(config.origin + "/?invitation=" + reason, status_code=303)
        else:
            response = JSONResponse({"detail": exc.detail}, status_code=exc.status_code)
    if session:
        cookie(response, config, config.session_cookie, session, SESSION_SECONDS)
        clear_cookie(response, config, config.flow_cookie + "_join")
    elif join_token:
        cookie(response, config, config.flow_cookie + "_join", join_token, JOIN_SECONDS)
    clear_cookie(response, config, config.flow_cookie + "_invite")
    return response


@router.get("/join")
def joining(request: Request):
    from backend.auth import csrf_token
    config, store, row, token = join_context(request)
    return {"invitation": view(row), "spreadsheet": public_binding(store.binding(row["household_id"])),
            "csrf_token": csrf_token(token), "membership_active": False,
            "detail": "공유 확인을 재시도해 주세요. 파일 접근이 없으면 같은 파일을 Picker에서 선택해 주세요."}


@router.post("/resume")
def resume(request: Request):
    from backend.auth import clear_cookie, cookie
    config, store, _, token = join_context(request, write=True)
    store.limit("resume", 60, 600)
    session = advance(config, store, token, request.cookies.get(config.session_cookie, ""))
    response = JSONResponse({"membership_active": True})
    cookie(response, config, config.session_cookie, session, SESSION_SECONDS)
    clear_cookie(response, config, config.flow_cookie + "_join")
    return response


@router.post("/picker")
def picker(request: Request):
    from backend.shared_sheets import picker_credentials
    config, store, row, _ = join_context(request, write=True)
    enabled()
    with store.operation():
        # Recheck after acquiring the operation lock; cancellation may race.
        row = store.join(request.cookies[config.flow_cookie + "_join"])
        return {**picker_credentials(config, store, row["user_id"]), "spreadsheet_id": row["spreadsheet_id"]}


def cleanup(config, store, row):
    try:
        # Completed cleanup is an immutable receipt. Retrying an old revoke
        # must not touch a newly granted permission for the same Google user.
        if row["cleanup"] != "done":
            return cleanup_pending(config, store, row)
    except HTTPException:
        store.cleanup_result(row["id"], "pending", True)
    return cleanup_view(store.get(row["id"]))


def cleanup_pending(config, store, row):
    with store.operation():
        row = store.get(row["id"])
        if row["status"] not in TERMINAL:
            raise HTTPException(409, "초대 취소 또는 접근 해제가 먼저 필요합니다.")
        # Local invalidation already committed even if Drive is unavailable.
        if row["cleanup"] != "done":
            if row["permission_id"] or row["permission_attempt"]:
                enabled()
            cleanup_share(store, row, SharingGoogle(config, store, row["owner_user_id"]))
    return cleanup_view(store.get(row["id"]))


def cleanup_view(row):
    return {"invitation": view(row), "app_access": False,
            "detail": ("앱 접근은 차단했습니다. Google 공유 정리/외부 경로 권한을 확인해 주세요."
                       if row["cleanup"] != "done" or row["residual_access"] else "앱 접근 차단과 앱 공유 권한 정리를 확인했습니다.")}


@router.delete("/{invitation_id}")
def cancel(invitation_id: str, request: Request):
    config, store = context(request, owner=True)
    return cleanup(config, store, store.stop(invitation_id))


@router.post("/{invitation_id}/revoke")
def revoke(invitation_id: str, request: Request):
    config, store = context(request, owner=True)
    return cleanup(config, store, store.stop(invitation_id, revoke=True))


class CleanupConfirmation(InputModel):
    confirmed_in_drive: Literal[True]


@router.post("/{invitation_id}/confirm-cleanup")
def confirm_cleanup(invitation_id: str, data: CleanupConfirmation, request: Request):
    """Explicit owner recovery for an uncertain send with no discoverable ID.

    No Google mutation. The owner must have inspected/removed direct access in
    Drive; the server independently verifies the full permission list and logs
    that this receipt includes manual confirmation, rather than automatic proof.
    """
    config, store = context(request, owner=True)
    with store.operation():
        row = store.get(invitation_id)
        if row["status"] not in TERMINAL:
            raise HTTPException(409, "초대 취소 또는 접근 해제 후 확인해 주세요.")
        if row["cleanup"] == "done":
            return cleanup_view(row)
        enabled()
        api = SharingGoogle(config, store, row["owner_user_id"])
        api.owned(row["spreadsheet_id"])
        permissions = api.permissions(row["spreadsheet_id"])
        if any(matches(p, row["email"]) or p["id"] == row["permission_id"] for p in permissions):
            raise HTTPException(409, "Google Drive에 직접 공유가 남아 있습니다. 정리 후 다시 확인해 주세요.")
        residual = any(p.get("type") in {"anyone", "domain", "group"} for p in permissions)
        store.confirm_cleanup(row["id"], request.state.identity["user_id"], residual)
    return {**cleanup_view(store.get(row["id"])), "manually_confirmed": True}
