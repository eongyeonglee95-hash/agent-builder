"""Local single-household app: profile, manual ledger and strategy display."""
from pathlib import Path
from typing import Literal
from uuid import UUID
from urllib.parse import urlparse

from fastapi import FastAPI, HTTPException, Request, Query, Response
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import ValidationError
import yaml

from backend.strategies import StrategyDisplay, load_strategy_display
from backend import storage, rebalance, registration, google_api

app = FastAPI(title="둘이서은퇴 · 로컬 API", version="0.1.0", docs_url="/api/docs",
              redoc_url=None, openapi_url="/api/openapi.json")
app.add_middleware(TrustedHostMiddleware, allowed_hosts=["127.0.0.1", "localhost", "[::1]"])
app.include_router(registration.router)   # REG-01 자산 등록(사진·파일) — Claude 담당
app.include_router(google_api.router)     # SHEET-01 구글 시트 연결 — Claude 담당


@app.middleware("http")
async def local_boundary(request: Request, call_next):
    if request.url.path.startswith("/api/"):
        origin = request.headers.get("origin")
        if request.method not in ("GET", "HEAD", "OPTIONS"):
            if not origin or request.headers.get("x-retire-local") != "1":
                return JSONResponse({"detail": "A local app request is required"}, status_code=403)
        if (origin and urlparse(origin).netloc != request.headers.get("host")) or request.headers.get("sec-fetch-site") == "cross-site":
            return JSONResponse({"detail": "Cross-origin requests are not supported"}, status_code=403)
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    return response


@app.get("/api/health")
def health():
    return {"status": "ok", "mode": "local", "broker_connected": False}

@app.get("/api/family")
def family():
    return storage.get_family()

@app.put("/api/family")
def save_family(data: storage.FamilyInput):
    return storage.save_family(data)

@app.get("/api/assets")
def assets():
    return storage.list_assets()

@app.post("/api/assets", status_code=201)
def create_asset(data: storage.AssetCreate):
    return storage.create_asset(data)

@app.put("/api/assets/{asset_id}")
def update_asset(asset_id: UUID, data: storage.AssetUpdate):
    return storage.update_asset(asset_id, data)

@app.delete("/api/assets/{asset_id}", status_code=204)
def delete_asset(asset_id: UUID, version: int = Query(ge=1)):
    storage.delete_asset(asset_id, version)
    return Response(status_code=204)

@app.get("/api/dashboard")
def dashboard(owner: Literal["together", "me", "partner"] = "together"):
    return storage.dashboard(owner)


@app.get("/api/strategies", response_model=list[StrategyDisplay])
def strategies():
    try:
        return load_strategy_display()
    except (OSError, yaml.YAMLError, ValidationError, KeyError, TypeError, AttributeError):
        raise HTTPException(status_code=503, detail="전략 규칙을 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.") from None


@app.get("/api/rebalance/options")
def rebalance_options(owner: Literal["together", "me", "partner"] = "together"):
    return rebalance.options(owner)


@app.post("/api/rebalance/preview")
def rebalance_preview(data: rebalance.PreviewInput):
    try:
        return rebalance.preview(data)
    except (OSError, yaml.YAMLError, ValidationError, KeyError, TypeError, ValueError, AttributeError):
        raise HTTPException(503, "계산에 필요한 규칙을 확인할 수 없습니다. 설정을 확인해 주세요.") from None


dist = Path(__file__).resolve().parents[1] / "web" / "dist"
if dist.is_dir():
    # Only the compiled public UI is served. No project-root mount, no uploads.
    # Hash routing keeps unknown paths a 404 instead of masking API failures.
    app.mount("/", StaticFiles(directory=dist, html=True), name="web")
