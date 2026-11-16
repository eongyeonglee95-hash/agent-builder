"""SHARE-07 read-only configuration checks, never a live verification result.

No database is opened, no Google request is made, and no configuration values or
financial records are printed. Exit 0 means static configuration checks passed.
The integration gaps and real-account checklist still require separate evidence.
"""
import argparse
import json
import os
from pathlib import Path
import stat

from backend import auth_config


# These are deliberately unresolved, not a list of supported shared operations.
# Update with domain integration evidence, not merely a successful status code.
INTEGRATION_GAPS = (
    {"area": "워크북·등록", "requests": (("GET", "/api/workbook/summary"),
        ("GET", "/api/workbook/report.xlsx"), ("POST", "/api/register/commit"))},
    {"area": "보유종목·계좌", "requests": (("GET", "/api/holdings"),
        ("GET", "/api/register/accounts"), ("POST", "/api/register/accounts"))},
    {"area": "은퇴 계산·계획", "requests": (("GET", "/api/retirement"),
        ("PUT", "/api/retirement/plan"), ("POST", "/api/retirement/preview"))},
    {"area": "부동산 계산·계획", "requests": (("GET", "/api/property-move"),
        ("PUT", "/api/property-move"), ("POST", "/api/property-move/track"))},
)
LIVE_CHECKS = (
    "별도 테스트 저장소·합성 자료·테스트 시트임을 확인",
    "실제 오너/배우자 각각 로그인·drive.file 동의·같은 파일 재로그인",
    "같은 Google 프로젝트의 Picker 설정·기존 파일 승인/선택",
    "초대 발급·공유·수락·재로그인·제3자 차단",
    "앱 모든 세션 접근 해제와 Drive 직접 권한·잔존 접근 각각 확인",
    "이전 전 백업 복원·원본 보존·건수/합계/고정 명의 대조",
    "두 기기의 각 영역 공유 읽기/쓰기·계획/계산 일치",
    "동시 저장·직접 편집 충돌·응답 유실·권한 철회·복구",
    "실제 HTTPS 인증서·프록시 신뢰 범위·쿠키·콜백 로그 비노출",
)


def private_path(path: Path, *, directory=False) -> bool:
    """Stat only: absent storage is checked after creation, not created here."""
    if path.is_symlink():
        return False
    try:
        info = path.stat()
    except FileNotFoundError:
        return True
    except OSError:
        return False
    expected_type = stat.S_ISDIR if directory else stat.S_ISREG
    return expected_type(info.st_mode) and not info.st_mode & 0o077


def inspect(target="https"):
    if target not in {"local", "https"}:
        raise ValueError("target must be local or https")
    checks = []

    def add(name, ok, action):
        checks.append({"id": name, "status": "pass" if ok else "fail", "action": action})

    add("web_mode", os.environ.get("RETIRE_AUTH_MODE") == "web", "RETIRE_AUTH_MODE=web")
    add("sheets_enabled", os.environ.get("RETIRE_SHEETS", "on").lower() != "off", "RETIRE_SHEETS=on")
    config = None
    try:
        config = auth_config.load_config()
        add("oauth_config", True, "OAuth 파일 형식·비공개 권한·정확한 콜백 일치만 확인; 실제 로그인 별도")
    except auth_config.ConfigurationError as exc:
        add("oauth_config", False, str(exc))  # errors are field names, never values
    try:
        auth_config.load_picker_config()
        add("picker_config", True, "키/번호 형식만 확인; 같은 프로젝트·API 활성화·원본 제한은 콘솔에서 확인")
    except auth_config.ConfigurationError as exc:
        add("picker_config", False, str(exc))
    if target == "https":
        add("https_origin", bool(config and config.secure), "RETIRE_AUTH_ORIGIN에 검수용 HTTPS 원본 설정; TLS 실제 검수 별도")
        add("bootstrap_closed", os.environ.get("RETIRE_AUTH_BOOTSTRAP", "0") == "0", "오너 최초 설정 후 RETIRE_AUTH_BOOTSTRAP=0")
        add("http_disabled", os.environ.get("RETIRE_AUTH_ALLOW_HTTP", "0") == "0", "HTTPS 검수에서는 RETIRE_AUTH_ALLOW_HTTP=0")
    if config:
        # No AuthStore/DataStore constructors: even read methods initialize tables.
        db = config.db_path
        local_ledger = auth_config.ROOT / "data/local/retire-together.sqlite3"
        try:
            separate = db.resolve() != local_ledger.resolve()
            if db.exists() and local_ledger.exists():
                separate = separate and not db.samefile(local_ledger)
        except OSError:
            separate = False
        add("separate_auth_storage", separate, "인증 DB와 금융 DB를 서로 다른 파일로 지정")
        add("private_storage", private_path(db) and private_path(db.parent, directory=True)
            and private_path(db.parent / "shared-data-backups", directory=True),
            "인증 DB 0600·상위 폴더/백업 폴더 0700·심볼릭 링크 없음; 미생성 경로는 생성 후 재검사")
    return {"target": target, "configuration_ok": all(c["status"] == "pass" for c in checks),
            "checks": checks, "integration_gaps": INTEGRATION_GAPS,
            "live_verification": "not_run", "pending_live_checks": LIVE_CHECKS,
            "notice": "설정 검사 통과는 배포/이전 승인이나 SHARE-07 완료가 아닙니다. 운영 자료를 이전하지 마세요."}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", choices=("local", "https"), default="https")
    args = parser.parse_args(argv)
    result = inspect(args.target)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["configuration_ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
