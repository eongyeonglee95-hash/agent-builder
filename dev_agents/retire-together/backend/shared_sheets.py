"""Owner-only common file setup; shared data migration/UI are separate tasks."""
from contextlib import contextmanager
from contextvars import ContextVar
import os
from typing import Annotated

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse, RedirectResponse
from pydantic import Field

from backend import auth_google
from backend.auth_config import ConfigurationError, load_picker_config
from backend.auth_store import FLOW_SECONDS
from backend.shared_sheets_google import CreateRejected, GoogleFiles, file_id, token_values
from backend.shared_sheets_store import SheetStore
from backend.storage import InputModel

router = APIRouter(prefix="/shared", tags=["shared-sheets"])
# Set in the async boundary, then copied into FastAPI's sync worker thread.
request_context: ContextVar[tuple | None] = ContextVar("shared_sheet_context", default=None)


def context(request: Request, *, member: bool = False):
    config = getattr(request.state, "auth_config", None)
    identity = getattr(request.state, "identity", None)
    if config is None or identity is None:
        raise HTTPException(409, "웹 로그인이 필요합니다.")
    store = SheetStore(config.db_path)
    store.member(identity) if member else store.owner(identity)
    return config, identity, store


def enabled():
    if os.environ.get("RETIRE_SHEETS", "").lower() == "off":
        raise HTTPException(409, "이 서버는 Google 시트 연결이 꺼져 있습니다.")


def client(config, store, identity):
    enabled()
    return GoogleFiles(config, store, identity["user_id"])


def public_binding(binding):
    if not binding:
        return None
    sid = binding["spreadsheet_id"]
    return {"spreadsheet_id": sid, "url": f"https://docs.google.com/spreadsheets/d/{sid}/edit" if sid else None,
            "ready": bool(binding["ready"])}


@router.get("/status")
def status(request: Request):
    config, identity, store = context(request, member=True)
    binding = store.binding(identity["household_id"])
    result = {"spreadsheet": public_binding(binding), "connected": store.grant(identity["user_id"]) is not None,
              "health": "unlinked", "active": False, "read_only": True}
    from backend.shared_data_store import DataStore
    result["data_started"] = DataStore(config.db_path).started(identity["household_id"])
    if binding:
        result["health"] = "create_rejected" if binding["retryable"] else "setup_pending"
        if binding["spreadsheet_id"]:
            try:
                api = client(config, store, identity)
                if identity["role"] == "owner":
                    api.owned(binding["spreadsheet_id"])
                else:
                    from backend.household_invites_google import SharingGoogle
                    SharingGoogle(config, store, identity["user_id"]).accessible(binding["spreadsheet_id"])
                if binding["ready"]:
                    api.validate(binding["spreadsheet_id"])
                    result.update(health="ok", active=True)
            except HTTPException as exc:
                result.update(health="attention", detail=exc.detail)
    return result


@router.post("/connect")
def connect(request: Request):
    from backend.auth import cookie
    config, identity, store = context(request, member=True)
    enabled()
    state, browser, nonce, verifier = store.new_sheet_flow(identity["user_id"], request.cookies[config.session_cookie])
    response = JSONResponse({"authorization_url": auth_google.authorization_url(config, state, nonce, verifier, files=True)})
    cookie(response, config, config.flow_cookie + "_files", browser, FLOW_SECONDS)
    return response


def callback(request: Request):
    """Same registered callback as login, separate state/cookie/session binding."""
    from backend.auth import clear_cookie
    config = request.state.auth_config
    store = SheetStore(config.db_path)
    try:
        enabled()
        params = request.query_params
        if len(params.getlist("state")) != 1 or not 20 <= len(params["state"]) <= 128:
            raise HTTPException(400, "시트 연결 요청이 일치하지 않습니다.")
        session = request.cookies.get(config.session_cookie, "")
        flow = store.consume_sheet_flow(params["state"], request.cookies.get(config.flow_cookie + "_files", ""), session)
        if len(params.getlist("code")) != 1 or not 1 <= len(params["code"]) <= 4096 or "error" in params:
            raise HTTPException(400, "시트 연결 동의가 취소되었거나 응답이 올바르지 않습니다.")
        identity = store.session(session)
        if identity is None or identity["user_id"] != flow["user_id"]:
            raise HTTPException(401, "로그인 후 시트 연결을 다시 시작해 주세요.")
        member = store.member(identity)
        sub, _, tokens = auth_google.exchange_verified(config, params["code"], flow["nonce"], flow["verifier"])
        if sub != member["google_sub"]:
            raise HTTPException(403, "로그인한 가구 구성원의 Google 계정으로 동의해 주세요.")
        with store.operation():
            # Recheck logout/revocation after the remote code exchange.
            if store.session(session) is None:
                raise HTTPException(401, "로그인 후 시트 연결을 다시 시작해 주세요.")
            store.save_grant(identity["user_id"], *token_values(tokens))
        response = RedirectResponse(config.origin + "/?sheet_connection=ready", status_code=303)
    except HTTPException as exc:
        if "text/html" in request.headers.get("accept", ""):
            reason = ("cancelled" if request.query_params.get("error") == "access_denied" else
                      "owner" if exc.status_code == 403 else "expired" if exc.status_code == 401 else "failed")
            response = RedirectResponse(config.origin + "/?sheet_connection=" + reason, status_code=303)
        else:
            response = JSONResponse({"detail": exc.detail}, status_code=exc.status_code)
    clear_cookie(response, config, config.flow_cookie + "_files")
    return response


def finish(store, identity, api, binding):
    sid = binding["spreadsheet_id"]
    api.owned(sid)
    if binding["ready"]:
        # A previously initialized file may have been edited directly in Drive.
        # Recheck only; retries must not repair or overwrite an existing file.
        api.validate(sid)
    else:
        if binding["kind"] == "create":
            api.prepare(sid)
        else:
            api.validate(sid)
        store.ready(identity["household_id"])
    return {"spreadsheet": public_binding(store.binding(identity["household_id"])), "migrated": 0, "read_only": True}


@router.post("/spreadsheet")
def create(request: Request):
    config, identity, store = context(request)
    api = client(config, store, identity)
    with store.operation():
        binding = store.binding(identity["household_id"])
        if binding is None or binding["retryable"]:
            # Validate the grant before reserving the irreversible attempt.
            api._token()
            if binding is None:
                binding = store.reserve(identity["household_id"], "create")
            else:
                store.retryable(identity["household_id"], False)
            # The committed reservation means this is the only allowed POST.
            try:
                sid = api.create(binding["operation_id"])
            except CreateRejected:
                store.retryable(identity["household_id"], True)
                raise
            store.bind(identity["household_id"], sid)
        elif binding["spreadsheet_id"] is None:
            sid = api.recover(binding["operation_id"])
            store.bind(identity["household_id"], sid)
        return finish(store, identity, api, store.binding(identity["household_id"]))


class Selection(InputModel):
    spreadsheet_id: Annotated[str, Field(min_length=20, max_length=200)]


@router.put("/spreadsheet")
def select(data: Selection, request: Request):
    config, identity, store = context(request)
    sid = file_id(data.spreadsheet_id)
    api = client(config, store, identity)
    with store.operation():
        binding = store.binding(identity["household_id"])
        if binding:
            if binding["spreadsheet_id"] != sid:
                raise HTTPException(409, "기존 파일 연결 또는 생성 확인이 남아 있습니다. 다른 파일로 바꾸지 않았습니다.")
        else:
            api.owned(sid)
            api.validate(sid)
            binding = store.reserve(identity["household_id"], "select", sid)
        return finish(store, identity, api, binding)


@router.delete("/connection")
def disconnect(request: Request):
    config, identity, store = context(request, member=True)
    with store.operation():
        store.disconnect(identity["user_id"])
    # File binding and application session remain; no local fallback or Google
    # account-wide revoke (that could revoke the separate login grant as well).
    return {"connected": False, "spreadsheet": public_binding(store.binding(identity["household_id"]))}


@router.post("/picker")
def picker(request: Request):
    config, identity, store = context(request, member=True)
    result = picker_credentials(config, store, identity["user_id"])
    if identity["role"] == "partner":
        binding = store.binding(identity["household_id"])
        if not binding or not binding["ready"]:
            raise HTTPException(409, "가구의 공통 파일 연결을 확인해 주세요.")
        result["spreadsheet_id"] = binding["spreadsheet_id"]
    return result


def picker_credentials(config, store, user_id):
    try:
        key, app_id = load_picker_config()
    except ConfigurationError:
        raise HTTPException(503, "서버의 Google Picker API 키와 프로젝트 번호 설정이 필요합니다.") from None
    enabled()
    api = GoogleFiles(config, store, user_id)
    token = api._token()
    # Picker requires an ephemeral browser access token. Refresh tokens never
    # leave the server. SHARE-06 must keep this response in memory only.
    return {"access_token": token, "expires_at": store.grant(user_id)["expires_at"],
            "developer_key": key, "app_id": app_id, "origin": config.origin}


def open_for_request():
    ctx = request_context.get()
    if ctx is None:
        raise HTTPException(503, "공통 시트의 인증된 가구 정보를 확인할 수 없습니다.")
    config, identity = ctx
    store = SheetStore(config.db_path)
    store.owner(identity)
    binding = store.binding(identity["household_id"])
    if binding is None:
        # The existing owner-local ledger remains available until explicit setup.
        # It must never use the computer-wide legacy Google configuration.
        return None
    if not binding["ready"] or not binding["spreadsheet_id"]:
        raise HTTPException(409, "공통 시트 연결 확인이 필요합니다. 로컬 장부로 전환하지 않았습니다.")
    api = client(config, store, identity)
    api.owned(binding["spreadsheet_id"])
    return api.sheets(binding["spreadsheet_id"])


@contextmanager
def financial_write_guard(config, identity):
    # Hold the same setup lock across legacy mutations so a request that started
    # just before file setup cannot write a local snapshot after setup commits.
    # Once linked, SHARE-05 must implement shared writes before lifting this gate.
    store = SheetStore(config.db_path)
    with store.operation():
        if store.binding(identity["household_id"]) is not None:
            raise HTTPException(409, "공통 시트의 자료 이전·동시 저장 연결 전에는 앱에서 읽기만 가능합니다.")
        yield
