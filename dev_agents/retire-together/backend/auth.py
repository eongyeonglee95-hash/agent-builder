"""SHARE-02 authentication routes and the common API authorization boundary."""
import hmac
import json
import logging
import secrets
from urllib.parse import urlsplit

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, Response
from starlette.concurrency import run_in_threadpool

from backend import auth_config, auth_google
from backend.auth_config import AuthConfig, CALLBACK, ConfigurationError, LOOPBACK_HOSTS
from backend.auth_store import AuthStore, FLOW_SECONDS, SESSION_SECONDS

router = APIRouter(prefix="/api/auth", tags=["authentication"])
PUBLIC = {"/api/health", "/api/auth/status", "/api/auth/google/login", CALLBACK}
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


class RedactOAuthQuery(logging.Filter):
    """Uvicorn access logs otherwise contain the callback authorization code/state."""
    def filter(self, record):
        if isinstance(record.args, tuple) and len(record.args) == 5:
            args = list(record.args)
            if isinstance(args[2], str) and args[2].split("?", 1)[0].startswith("/api/auth/"):
                args[2] = args[2].split("?", 1)[0]
                record.args = tuple(args)
        return True


access_logger = logging.getLogger("uvicorn.access")
if not any(isinstance(f, RedactOAuthQuery) for f in access_logger.filters):
    access_logger.addFilter(RedactOAuthQuery())


def csrf_token(token: str) -> str:
    return hmac.digest(token.encode(), b"retire-session-csrf-v1", "sha256").hex()


def cookie(response: Response, config: AuthConfig, name: str, value: str, lifetime: int):
    response.set_cookie(name, value, max_age=lifetime, httponly=True,
                        secure=config.secure, samesite="lax", path="/")


def clear_cookie(response: Response, config: AuthConfig, name: str):
    response.delete_cookie(name, httponly=True, secure=config.secure, samesite="lax", path="/")


def bootstrap_allowed(request: Request, config: AuthConfig) -> bool:
    # Deliberately no forwarded-host/IP trust for the one-time operator setup.
    return (config.bootstrap and urlsplit(config.origin).hostname in LOOPBACK_HOSTS
            and request.client is not None and request.client.host in LOOPBACK_HOSTS
            and not any(key in request.headers for key in (
                "forwarded", "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto")))


def web_context(request: Request) -> tuple[AuthConfig, AuthStore]:
    config = getattr(request.state, "auth_config", None)
    if config is None:
        raise HTTPException(409, "웹 로그인 모드를 먼저 설정해 주세요.")
    return config, AuthStore(config.db_path)


def popup_result(config: AuthConfig, error: str = "") -> HTMLResponse:
    # No identity, code, cookie, or CSRF token is sent to the opener. It must fetch
    # and verify its own server session, including when Google severs window.opener.
    nonce = secrets.token_urlsafe(24)
    message = json.dumps({"type": "retire:login-result", "error": error})
    origin = json.dumps(config.origin).replace("<", "\\u003c")
    response = HTMLResponse(f'''<!doctype html><html lang="ko"><meta charset="utf-8">
<title>로그인 확인</title><p>원래 앱 화면에서 로그인 결과를 확인해 주세요.</p>
<a href="/">앱으로 돌아가기</a><script nonce="{nonce}">
history.replaceState(null, '', '/');
try {{ if (window.opener) window.opener.postMessage({message}, {origin}); }} catch (_) {{}}
window.close();
</script></html>''')
    response.headers["Content-Security-Policy"] = f"default-src 'none'; script-src 'nonce-{nonce}'; base-uri 'none'; frame-ancestors 'none'"
    return response


@router.get("/status")
def status(request: Request):
    config = getattr(request.state, "auth_config", None)
    if config is None:
        return {"mode": "local", "login_enabled": False}
    store = AuthStore(config.db_path)
    return {"mode": "web", "login_enabled": True, "initialized": store.initialized()}


@router.get("/google/login")
def login(request: Request):
    config, store = web_context(request)
    bootstrap = not store.initialized()
    if bootstrap and not bootstrap_allowed(request, config):
        raise HTTPException(403, "운영자의 로컬 최초 설정이 필요합니다.")
    state, browser, nonce, verifier = store.new_flow(
        request.cookies.get(config.flow_cookie, ""), bootstrap,
        popup=request.query_params.get("popup") == "1")
    response = RedirectResponse(auth_google.authorization_url(
        config, state, nonce, verifier,
        select_account=bootstrap or request.query_params.get("choose") == "1"), status_code=303)
    cookie(response, config, config.flow_cookie, browser, FLOW_SECONDS)
    return response


@router.get("/google/callback")
def callback(request: Request):
    config, store = web_context(request)
    flow = None
    try:
        params = request.query_params
        if any(len(params.getlist(k)) != 1 for k in ("state",)):
            raise HTTPException(400, "로그인 요청이 일치하지 않습니다.")
        state, browser = params["state"], request.cookies.get(config.flow_cookie, "")
        if not 20 <= len(state) <= 128 or not 20 <= len(browser) <= 128:
            raise HTTPException(400, "로그인 요청이 일치하지 않습니다.")
        flow = store.consume_flow(state, browser)
        if ("error" in params or len(params.getlist("code")) != 1
                or not 1 <= len(params["code"]) <= 4096):
            raise HTTPException(400, "Google 로그인이 취소되었거나 응답이 올바르지 않습니다.")
        sub, email = auth_google.exchange_identity(config, params["code"], flow["nonce"], flow["verifier"])
        token = store.login(sub, email, bool(flow["bootstrap"]) and bootstrap_allowed(request, config),
                            request.cookies.get(config.session_cookie, ""))
        response = popup_result(config) if flow["popup"] else RedirectResponse(config.origin + "/", status_code=303)
        cookie(response, config, config.session_cookie, token, SESSION_SECONDS)
    except HTTPException as exc:
        error = "not_member" if exc.status_code == 403 else "failed"
        if flow and flow["popup"]:
            response = popup_result(config, error)
        elif "text/html" in request.headers.get("accept", ""):
            response = RedirectResponse(config.origin + "/?login_error=" + error, status_code=303)
        else:
            response = JSONResponse({"detail": exc.detail}, status_code=exc.status_code)
    clear_cookie(response, config, config.flow_cookie)
    return response


@router.get("/session")
def session(request: Request):
    config, _ = web_context(request)
    return {**request.state.identity, "csrf_token": csrf_token(request.cookies[config.session_cookie])}


@router.post("/logout", status_code=204)
def logout(request: Request):
    config, store = web_context(request)
    store.logout(request.cookies.get(config.session_cookie, ""))
    response = Response(status_code=204)
    clear_cookie(response, config, config.session_cookie)
    clear_cookie(response, config, config.flow_cookie)
    return response


def check_boundary(request: Request):
    """Runs before every route, including downloads, legacy settings and unknown APIs."""
    path = request.url.path
    is_api = path == "/api" or path.startswith("/api/")
    try:
        mode = auth_config.mode()
        config = auth_config.load_config() if mode == "web" else None
    except ConfigurationError:
        raise HTTPException(503, "웹 인증 설정을 확인해 주세요. 서버 설정 검사를 실행할 수 있습니다.") from None
    host = request.headers.get("host", "")
    if config is None:
        try:
            parsed_host = urlsplit("http://" + host)
            hostname = parsed_host.hostname
            if (parsed_host.username or parsed_host.password or parsed_host.path
                    or parsed_host.query or parsed_host.fragment or parsed_host.port == 0):
                hostname = None
        except ValueError:
            hostname = None
        if hostname not in LOOPBACK_HOSTS:
            raise HTTPException(400, "Invalid host header")
        if path.startswith("/api/auth/") and path != "/api/auth/status":
            raise HTTPException(409, "웹 로그인 모드를 먼저 설정해 주세요.")
        if is_api:
            origin = request.headers.get("origin")
            if request.method not in SAFE_METHODS and (
                not origin or request.headers.get("x-retire-local") != "1"
            ):
                raise HTTPException(403, "A local app request is required")
            try:
                origin_host = urlsplit(origin).netloc if origin else None
            except ValueError:
                raise HTTPException(403, "Invalid origin") from None
            if ((origin and origin_host != host)
                    or request.headers.get("sec-fetch-site") == "cross-site"):
                raise HTTPException(403, "Cross-origin requests are not supported")
        return

    if host != urlsplit(config.origin).netloc:
        raise HTTPException(400, "Invalid host header")
    # HTTPS termination must be reflected by a correctly configured trusted proxy.
    if request.url.scheme != urlsplit(config.origin).scheme:
        raise HTTPException(400, "접속 프로토콜이 서버 설정과 일치하지 않습니다.")
    request.state.auth_config = config
    if not is_api:
        return
    # Only this GET callback permits Google's cross-site top-level navigation.
    callback_get = path == CALLBACK and request.method == "GET"
    origin = request.headers.get("origin")
    if not callback_get and ((origin and origin != config.origin)
                             or request.headers.get("sec-fetch-site") == "cross-site"):
        raise HTTPException(403, "다른 출처의 요청은 허용하지 않습니다.")
    if path in PUBLIC and request.method == "GET":
        return
    token = request.cookies.get(config.session_cookie, "")
    identity = AuthStore(config.db_path).session(token)
    if identity is None:
        raise HTTPException(401, "로그인이 필요합니다.")
    request.state.identity = identity
    if request.method not in SAFE_METHODS:
        supplied = request.headers.get("x-retire-csrf", "")
        if origin != config.origin or not hmac.compare_digest(supplied.encode(), csrf_token(token).encode()):
            raise HTTPException(403, "요청 확인에 실패했습니다. 새로고침 후 다시 시도해 주세요.")
    if path.startswith("/api/google/"):
        # InstalledAppFlow and the computer-wide token are never exposed in web mode.
        raise HTTPException(409, "웹 공통 시트 연결은 후속 작업에서 제공됩니다.")
    if not path.startswith("/api/auth/") and identity["role"] != "owner":
        # Existing financial APIs still use owner-relative me/partner. SHARE-04/05
        # must supply per-member authorization/mapping before enabling partner access.
        raise HTTPException(403, "이 자료의 가구 구성원 권한 연결이 필요합니다.")


async def boundary(request: Request, call_next):
    try:
        await run_in_threadpool(check_boundary, request)
        response = await call_next(request)
    except HTTPException as exc:
        response = JSONResponse({"detail": exc.detail}, status_code=exc.status_code)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    if request.url.path.startswith("/api"):
        response.headers["Cache-Control"] = "no-store"
    return response
