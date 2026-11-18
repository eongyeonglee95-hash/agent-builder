"""Save a Telegram bot token locally without echoing it or making network calls."""
import getpass
import os
from pathlib import Path
import re
import sys
import tempfile


def main():
    if not sys.stdin.isatty():
        raise SystemExit('터미널에서 직접 실행해 주세요.')
    path = Path(__file__).resolve().parents[1] / '.env'
    if path.is_symlink():
        raise SystemExit('.env가 심볼릭 링크여서 저장하지 않았어요.')
    token = getpass.getpass('BotFather 토큰 붙여넣기 (화면에 표시되지 않아요): ').strip()
    if not re.fullmatch(r'[0-9]+:[A-Za-z0-9_-]+', token):
        raise SystemExit('토큰 형식을 확인해 주세요. 저장하지 않았어요.')
    original = path.read_text(encoding='utf-8') if path.exists() else ''
    lines = [line for line in original.splitlines()
             if not re.match(r'^\s*(?:export\s+)?TELEGRAM_BOT_TOKEN\s*=', line)]
    lines.append('TELEGRAM_BOT_TOKEN=' + token)
    fd, temp = tempfile.mkstemp(dir=path.parent, prefix='.env-', suffix='.tmp')
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as out:
            out.write('\n'.join(lines) + '\n')
        os.replace(temp, path)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)
    print('토큰을 로컬 .env에 저장했어요. 아직 메시지를 보내거나 연결 확인을 하지는 않았어요.')


if __name__ == '__main__':
    try:
        main()
    except (KeyboardInterrupt, EOFError):
        raise SystemExit('\n저장을 취소했어요.') from None
