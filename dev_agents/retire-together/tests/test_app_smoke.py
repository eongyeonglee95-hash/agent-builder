"""화면 스모크 테스트 — 메뉴 7개를 전부 열어 예외가 없는지. 숫자 검증은 tools/ 테스트가 한다."""
import pytest
from streamlit.testing.v1 import AppTest

from pathlib import Path

APP = Path(__file__).resolve().parents[1] / "app" / "main.py"
MENUS = ["홈", "입력", "연금", "리밸런싱", "세금·수령 설계", "부동산", "설정"]


@pytest.mark.parametrize("menu", MENUS)
def test_each_menu_renders(menu):
    at = AppTest.from_file(str(APP), default_timeout=90)
    at.run()
    at.sidebar.radio[0].set_value(menu).run()
    assert not at.exception, [e.value for e in at.exception]
    assert at.title[0].value  # "화면 = 질문 하나" 제목이 있다
