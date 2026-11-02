from tools.market import pick_exact


def test_pick_exact_prefers_exact_name():
    cands = [("360750", "TIGER 미국S&P500"), ("482730", "TIGER 미국S&P500타겟데일리커버드콜"), ("448290", "TIGER 미국S&P500(H)")]
    assert pick_exact("TIGER 미국S&P500", cands) == "360750"


def test_pick_exact_accepts_truncated_capture_name():
    cands = [("0048K0", "KODEX 차이나휴머노이드로봇")]
    assert pick_exact("KODEX 차이나휴머노이", cands) == "0048K0"


def test_pick_exact_ambiguous_returns_none():
    cands = [("1", "ACE 미국S&P500"), ("2", "ACE 미국S&P500미국채혼합50액티브")]
    assert pick_exact("ACE 미국", cands) is None
