"""Server-only web OAuth configuration. Local mode remains an explicit boundary."""
from dataclasses import dataclass, field
import json
import os
from pathlib import Path
import re
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parents[1]
LOOPBACK_HOSTS = {"localhost", "127.0.0.1", "::1"}
CALLBACK = "/api/auth/google/callback"


class ConfigurationError(ValueError):
    """Messages contain field names only, never configuration values."""


def load_picker_config() -> tuple[str, str]:
    """Syntax only; Google project matching/API restrictions require live checks."""
    key = os.environ.get("RETIRE_GOOGLE_PICKER_API_KEY", "")
    project = os.environ.get("RETIRE_GOOGLE_PROJECT_NUMBER", "")
    if not re.fullmatch(r"[A-Za-z0-9_-]+", key) or not re.fullmatch(r"[1-9][0-9]*", project):
        raise ConfigurationError("RETIRE_GOOGLE_PICKER_API_KEY and a positive ASCII RETIRE_GOOGLE_PROJECT_NUMBER are required")
    return key, project


def mode() -> str:
    value = os.environ.get("RETIRE_AUTH_MODE", "local")
    if value not in {"local", "web"}:
        raise ConfigurationError("RETIRE_AUTH_MODE must be local or web")
    return value


@dataclass(frozen=True)
class AuthConfig:
    origin: str
    client_id: str = field(repr=False)
    client_secret: str = field(repr=False)
    db_path: Path
    bootstrap: bool = False

    @property
    def redirect_uri(self) -> str:
        return self.origin + CALLBACK

    @property
    def secure(self) -> bool:
        return self.origin.startswith("https://")

    @property
    def session_cookie(self) -> str:
        return "__Host-retire_session" if self.secure else "retire_session_local"

    @property
    def flow_cookie(self) -> str:
        return "__Host-retire_oauth" if self.secure else "retire_oauth_local"


def load_config() -> AuthConfig:
    origin = os.environ.get("RETIRE_AUTH_ORIGIN", "http://127.0.0.1:5180")
    try:
        parsed = urlsplit(origin)
        valid = (parsed.scheme in {"http", "https"} and parsed.hostname
                 and not parsed.username and not parsed.password and not parsed.path
                 and not parsed.query and not parsed.fragment and parsed.port != 0)
    except ValueError:
        valid = False
    if not valid:
        raise ConfigurationError("RETIRE_AUTH_ORIGIN must be an origin without a path")
    if parsed.scheme != "https" and not (
        parsed.hostname in LOOPBACK_HOSTS and os.environ.get("RETIRE_AUTH_ALLOW_HTTP") == "1"
    ):
        raise ConfigurationError("HTTPS required; loopback HTTP needs RETIRE_AUTH_ALLOW_HTTP=1")
    bootstrap = os.environ.get("RETIRE_AUTH_BOOTSTRAP") == "1"
    if bootstrap and parsed.hostname not in LOOPBACK_HOSTS:
        raise ConfigurationError("RETIRE_AUTH_BOOTSTRAP is restricted to loopback setup")
    path = Path(os.environ.get("RETIRE_GOOGLE_WEB_CLIENT", ROOT / "data/local/google/web-client.json"))
    try:
        if path.stat().st_mode & 0o077:
            raise ConfigurationError("RETIRE_GOOGLE_WEB_CLIENT must be private (0600)")
        raw = json.loads(path.read_text())
        web = raw["web"]
        client_id, secret = web["client_id"], web["client_secret"]
        if not all(isinstance(v, str) and v.strip() for v in (client_id, secret)):
            raise ValueError
        if not client_id.endswith(".apps.googleusercontent.com"):
            raise ValueError
        redirects = web["redirect_uris"]
        if not isinstance(redirects, list) or not all(isinstance(v, str) for v in redirects):
            raise ValueError
        if origin + CALLBACK not in redirects:
            raise ConfigurationError("Register RETIRE_AUTH_ORIGIN + callback in the web OAuth client")
    except ConfigurationError:
        raise
    except (OSError, ValueError, KeyError, TypeError):
        raise ConfigurationError("A valid Google web client file is required") from None
    return AuthConfig(origin, client_id, secret,
                      Path(os.environ.get("RETIRE_AUTH_DB", ROOT / "data/local/auth/auth.sqlite3")),
                      bootstrap)


if __name__ == "__main__":
    # Read-only preflight: no Google request, database creation, or secret output.
    try:
        config = load_config()
        print("Web OAuth configuration valid; live login has not been verified.")
    except ConfigurationError as exc:
        print(str(exc))
        raise SystemExit(1) from None
