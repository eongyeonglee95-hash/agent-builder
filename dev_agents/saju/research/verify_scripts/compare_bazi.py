"""사주 원국 비교: lunar-python / bazi(0xf3cd) / sajupy / 자체 '한국식' 계산.
입력은 서울 출생 '당시 시계 시각'(local clock). 역사적 표준시·서머타임은 zoneinfo Asia/Seoul로 환산.
"""
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
import math

from lunar_python import Solar
import swisseph as swe

SEOUL = ZoneInfo("Asia/Seoul")
LON = 126.978  # 서울시청 경도
CST = timezone(timedelta(hours=8))
KST = timezone(timedelta(hours=9))
GAN = "甲乙丙丁戊己庚辛壬癸"
ZHI = "子丑寅卯辰巳午未申酉戌亥"

CASES = [
    # id, 설명, local clock, gender(1=M,0=F)
    ("A", "1990-05-15 10:30 남 (기본 예시)", datetime(1990, 5, 15, 10, 30), 1),
    ("B1", "1990-02-04 10:30 여 (입춘 11:14 KST 직전)", datetime(1990, 2, 4, 10, 30), 0),
    ("B2", "1990-02-04 11:30 여 (입춘 직후)", datetime(1990, 2, 4, 11, 30), 0),
    ("C", "1987-07-20 05:20 남 (서머타임 기간)", datetime(1987, 7, 20, 5, 20), 1),
    ("D", "1958-03-10 07:10 여 (UTC+8:30 시기)", datetime(1958, 3, 10, 7, 10), 0),
    ("E", "1995-11-20 23:40 남 (야자시)", datetime(1995, 11, 20, 23, 40), 1),
    ("F", "2000-01-01 00:20 여 (조자시)", datetime(2000, 1, 1, 0, 20), 0),
    ("G", "1975-08-25 13:15 남 (평범)", datetime(1975, 8, 25, 13, 15), 1),
]


def gz60(i):
    return GAN[i % 10] + ZHI[i % 12]


def eot_minutes(utc_dt):
    """균시차(분) — Swiss Ephemeris swe.time_equ (일 단위 반환)."""
    jd = swe.julday(utc_dt.year, utc_dt.month, utc_dt.day,
                    utc_dt.hour + utc_dt.minute / 60 + utc_dt.second / 3600)
    return swe.time_equ(jd) * 1440


def to_utc(local):
    return local.replace(tzinfo=SEOUL).astimezone(timezone.utc)


def lunar_ec(dt_naive, sect=2):
    ec = Solar.fromYmdHms(dt_naive.year, dt_naive.month, dt_naive.day,
                          dt_naive.hour, dt_naive.minute, 0).getLunar().getEightChar()
    ec.setSect(sect)
    return ec


def ec_str(ec):
    return f"{ec.getYear()} {ec.getMonth()} {ec.getDay()} {ec.getTime()}"


def korean_way(local, hour_basis="kst", zi="split"):
    """자체 계산(제안안).
    - 연·월주: 절입 '절대 시각'(lunar-python 절기 UTC+8 → UTC) 과 출생 UTC 비교
    - 일·시주: hour_basis = 'kst'(UTC+9 표준시로 환산, 서머타임·8:30 제거)
                           'lmt'(지방평균시 = UTC + 경도/15)
                           'tst'(진태양시 = LMT + 균시차)
    - zi: 'split' = 23시대는 일주 당일 유지(야자시), 'next' = 23시부터 다음날 일주
    """
    utc = to_utc(local)
    # 연·월주: 절대 시각을 UTC+8 벽시계로 바꿔 lunar-python에 넣는다(절기표가 UTC+8 기준)
    cst_naive = utc.astimezone(CST).replace(tzinfo=None)
    ec_ym = lunar_ec(cst_naive)
    year_p, month_p = ec_ym.getYear(), ec_ym.getMonth()
    if hour_basis == "kst":
        t = utc.astimezone(KST).replace(tzinfo=None)
    else:
        t = (utc + timedelta(hours=LON / 15)).replace(tzinfo=None)
        if hour_basis == "tst":
            t = t + timedelta(minutes=eot_minutes(utc))
    sect = 2 if zi == "split" else 1
    ec_dh = lunar_ec(t, sect)
    return f"{year_p} {month_p} {ec_dh.getDay()} {ec_dh.getTime()}", t


def bazi_lib(local, gender, true_solar):
    from bazi.bazi import Bazi
    from bazi.school import BaziConfig, BaziPrecision
    from bazi.calendar import CalendarBackend
    cfg = BaziConfig(precision=BaziPrecision.MINUTE, backend=CalendarBackend.CELESTIAL)
    g = "male" if gender == 1 else "female"
    if true_solar:
        b = Bazi.create(local.replace(tzinfo=SEOUL), g, cfg, longitude=LON)
    else:
        b = Bazi.create(local, g, cfg)  # 순진한 사용: 한국 시계 시각을 그대로
    return f"{b.year_pillar} {b.month_pillar} {b.day_pillar} {b.hour_pillar}"


def sajupy_lib(local, solar):
    import sajupy
    r = sajupy.calculate_saju(local.year, local.month, local.day, local.hour, local.minute,
                              longitude=LON if solar else None, use_solar_time=solar,
                              utc_offset=9, early_zi_time=True)
    return f"{r['year_pillar']} {r['month_pillar']} {r['day_pillar']} {r['hour_pillar']}"


def main():
    rows = []
    for cid, desc, local, g in CASES:
        utc = to_utc(local)
        off = local.replace(tzinfo=SEOUL).utcoffset()
        r = {"id": cid, "desc": desc, "offset": str(off), "utc": utc.strftime("%Y-%m-%d %H:%M")}
        r["lunar_naive"] = ec_str(lunar_ec(local))
        kst, tk = korean_way(local, "kst")
        lmt, tl = korean_way(local, "lmt")
        tst, tt = korean_way(local, "tst")
        r["kr_kst"] = kst; r["kr_lmt"] = f"{lmt} (LMT {tl:%H:%M})"; r["kr_tst"] = f"{tst} (TST {tt:%H:%M})"
        r["kr_kst_next"] = korean_way(local, "kst", "next")[0]
        try:
            r["bazi_naive"] = bazi_lib(local, g, False)
            r["bazi_tst"] = bazi_lib(local, g, True)
        except Exception as e:
            r["bazi_naive"] = r["bazi_tst"] = f"ERR {e}"
        try:
            r["sajupy"] = sajupy_lib(local, False)
            r["sajupy_solar"] = sajupy_lib(local, True)
        except Exception as e:
            r["sajupy"] = r["sajupy_solar"] = f"ERR {e}"
        rows.append(r)
    for r in rows:
        print("=" * 80)
        for k, v in r.items():
            print(f"{k:14s} {v}")


if __name__ == "__main__":
    main()
