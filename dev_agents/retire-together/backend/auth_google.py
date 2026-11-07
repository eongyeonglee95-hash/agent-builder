"""Google authorization-code exchange and verified OpenID identity (login scopes only)."""
import base64
from hashlib import sha256
import hmac
import math
import time
from urllib.parse import urlencode

from fastapi import HTTPException
from google.auth.exceptions import GoogleAuthError
from google.auth.transport.requests import Request as GoogleRequest
from google.oauth2 import id_token
import requests

from backend.auth_config import AuthConfig

AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"


def authorization_url(config: AuthConfig, state: str, nonce: str, verifier: str, *, select_account: bool = True) -> str:
    challenge = base64.urlsafe_b64encode(sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    return AUTHORIZE_URL + "?" + urlencode({
        "client_id": config.client_id, "redirect_uri": config.redirect_uri,
        "response_type": "code", "scope": "openid email", "state": state, "nonce": nonce,
        "code_challenge": challenge, "code_challenge_method": "S256",
        **({"prompt": "select_account"} if select_account else {}),
    })


class BoundedGoogleRequest(GoogleRequest):
    def __call__(self, *args, **kwargs):
        kwargs["timeout"] = 10
        return super().__call__(*args, **kwargs)


def exchange_identity(config: AuthConfig, code: str, nonce: str, verifier: str) -> tuple[str, str]:
    try:
        response = requests.post(TOKEN_URL, data={
            "code": code, "client_id": config.client_id, "client_secret": config.client_secret,
            "redirect_uri": config.redirect_uri, "grant_type": "authorization_code", "code_verifier": verifier,
        }, timeout=10, allow_redirects=False)
        if response.status_code != 200:
            raise ValueError
        token = response.json()["id_token"]
        if not isinstance(token, str) or len(token) > 16000:
            raise ValueError
        # This library verifies the cryptographic signature, audience, issuer and times.
        with requests.Session() as transport:
            claims = id_token.verify_oauth2_token(token, BoundedGoogleRequest(session=transport), config.client_id)
        if not isinstance(claims, dict):
            raise ValueError
        if (claims.get("iss") not in {"accounts.google.com", "https://accounts.google.com"}
                or claims.get("aud") != config.client_id
                or claims.get("azp", config.client_id) != config.client_id
                or claims.get("email_verified") is not True
                or not isinstance(claims.get("nonce"), str)
                or not hmac.compare_digest(claims["nonce"], nonce)):
            raise ValueError
        now = time.time()
        if (type(claims.get("exp")) not in (int, float) or not math.isfinite(claims["exp"]) or claims["exp"] <= now
                or type(claims.get("iat")) not in (int, float) or not math.isfinite(claims["iat"]) or claims["iat"] > now):
            raise ValueError
        sub, email = claims["sub"], claims["email"]
        if not isinstance(sub, str) or not 1 <= len(sub) <= 255:
            raise ValueError
        if not isinstance(email, str) or not 3 <= len(email) <= 320 or "@" not in email:
            raise ValueError
        # Neither ID/access/refresh tokens nor authorization codes leave this adapter.
        return sub, email
    except (requests.RequestException, GoogleAuthError, ValueError, KeyError, TypeError, AttributeError, OverflowError):
        raise HTTPException(400, "Google 본인 확인에 실패했습니다. 로그인을 다시 시작해 주세요.") from None
