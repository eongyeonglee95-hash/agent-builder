"""둘이서은퇴 — Streamlit 메인 화면 (1주차 후반: 홈 + 연금 샘플, 나머지 메뉴는 준비 중).

실행: uv run streamlit run app/main.py
원칙: 화면 하나 = 질문 하나 (docs/SCREEN_REFERENCE.md). 숫자는 tools/가 계산, 화면은 그리기만.
"""
from __future__ import annotations

import sys
from pathlib import Path

import streamlit as st

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:  # streamlit은 app/를 경로에 넣으므로 프로젝트 루트(tools/)를 추가
    sys.path.insert(0, str(ROOT))

from app import pages  # noqa: E402

st.set_page_config(page_title="둘이서은퇴", page_icon="👫", layout="wide")

MENU = [
    ("홈", "우리 지금 괜찮아?"),
    ("입력", "숫자 넣기 가장 쉬운 곳"),
    ("연금", "결국 매달 얼마 받아?"),
    ("리밸런싱", "지금 뭘 사고팔까?"),
    ("세금·수령 설계", "어떻게 받아야 덜 내?"),
    ("부동산", "저 집까지 얼마 모자라?"),
    ("설정", "계좌 묶기 · 전략 · 가족"),
]

with st.sidebar:
    st.markdown("## 👫 둘이서은퇴")
    st.caption("우리의 오늘이, 더 나은 내일이 되도록")
    choice = st.radio("메뉴", [m[0] for m in MENU], label_visibility="collapsed")
    st.divider()
    view = st.segmented_control("보기", ["부부 전체", "나", "배우자"], default="부부 전체")
    st.caption("가족 계정 · 언경 · 남편")

question = dict(MENU)[choice]
st.markdown(f"<span style='color:#888'>{choice}</span>", unsafe_allow_html=True)
st.title(question)

if choice == "홈":
    pages.home(view)
elif choice == "연금":
    pages.pension(view)
elif choice == "리밸런싱":
    pages.rebalancing(view)
elif choice == "입력":
    pages.input_page(view)
elif choice == "설정":
    pages.settings(view)
else:
    pages.coming_soon(choice)
