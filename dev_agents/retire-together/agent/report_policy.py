"""Shared report policy loaded from the user-maintained writing guide."""
from pathlib import Path
VERSION = 'report-policy-v2-plain-language'
POLICY = (Path(__file__).resolve().parents[1] / 'docs/REPORT_WRITING_GUIDE.md').read_text(encoding='utf-8')
