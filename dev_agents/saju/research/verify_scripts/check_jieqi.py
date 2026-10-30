"""절입 시각 정확도: lunar-python(UTC+8) vs Swiss Ephemeris vs skyfield vs sajupy 표(KST)."""
from datetime import datetime, timedelta, timezone
import csv, pathlib
import swisseph as swe
from lunar_python import Solar
import sajupy

KST = timezone(timedelta(hours=9))
TERMS = {315: "立春", 345: "驚蟄", 15: "淸明", 45: "立夏", 75: "芒種", 105: "小暑",
         135: "立秋", 165: "白露", 195: "寒露", 225: "立冬", 255: "大雪", 285: "小寒"}
LP_NAME = {"立春": "立春", "驚蟄": "惊蛰", "淸明": "清明", "立夏": "立夏", "芒種": "芒种", "小暑": "小暑",
           "立秋": "立秋", "白露": "白露", "寒露": "寒露", "立冬": "立冬", "大雪": "大雪", "小寒": "小寒"}


def swe_cross(lon, y):
    # 대략 시작점에서 태양 황경이 lon 을 지나는 시각(UT)
    jd0 = swe.julday(y, 1, 1, 0)
    jd = swe.solcross_ut(lon, jd0, swe.FLG_SWIEPH)
    yy, mm, dd, hh = swe.revjul(jd)
    return datetime(yy, mm, dd, tzinfo=timezone.utc) + timedelta(hours=hh)


def lp_term(y, name):
    table = Solar.fromYmd(y, 6, 1).getLunar().getJieQiTable()
    s = table[LP_NAME[name]] if LP_NAME[name] in table else table[name]
    return datetime(s.getYear(), s.getMonth(), s.getDay(), s.getHour(), s.getMinute(), s.getSecond(),
                    tzinfo=timezone(timedelta(hours=8)))


def sajupy_terms():
    p = pathlib.Path(sajupy.__file__).parent / "calendar_data.csv"
    out = {}
    for r in csv.DictReader(open(p)):
        if r["term_time"]:
            t = str(int(float(r["term_time"])))
            out[(int(r["year"]), r["solar_term_hanja"])] = datetime.strptime(t, "%Y%m%d%H%M").replace(tzinfo=KST)
    return out


def main():
    sj = sajupy_terms()
    maxd_lp = maxd_sj = 0
    worst = []
    for y in range(1920, 2051):
        for lon, name in TERMS.items():
            s = swe_cross(lon, y)
            if s.year != y:
                continue
            try:
                l = lp_term(y, name)
                d = abs((l - s).total_seconds())
                maxd_lp = max(maxd_lp, d)
                worst.append((d, y, name, s.astimezone(KST), l.astimezone(KST)))
            except KeyError:
                pass
            k = None
            for kk in [(y, name), (y, name.replace("淸", "清"))]:
                if kk in sj:
                    k = sj[kk]
            if k:
                d2 = abs((k - s).total_seconds())
                if d2 > maxd_sj:
                    maxd_sj = d2; w2 = (y, name, s.astimezone(KST), k)
    worst.sort(reverse=True)
    print("lunar-python vs swisseph max diff sec:", round(maxd_lp, 1))
    for w in worst[:5]:
        print("  ", round(w[0], 1), w[1], w[2], w[3].strftime("%F %T"), w[4].strftime("%F %T"))
    print("sajupy vs swisseph max diff sec:", round(maxd_sj, 1), w2)
    for y in (1990, 2026, 2027):
        s = swe_cross(315, y).astimezone(KST)
        print(y, "立春 swisseph KST", s.strftime("%F %T"), "| lunar-python KST", lp_term(y, "立春").astimezone(KST).strftime("%F %T"))
    print("2027 절입(KST, swisseph):")
    for lon, name in sorted(TERMS.items(), key=lambda x: swe_cross(x[0], 2027)):
        s = swe_cross(lon, 2027)
        if s.year == 2027:
            print("  ", name, s.astimezone(KST).strftime("%F %H:%M"))


main()
