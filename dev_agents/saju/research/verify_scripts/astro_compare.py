"""출생 차트 비교: kerykeion vs pyswisseph 직접 vs skyfield vs flatlib. 1990-05-15 10:30 서울."""
from datetime import datetime, timezone
import swisseph as swe

LAT, LON = 37.5665, 126.978
UTC = datetime(1990, 5, 15, 1, 30, tzinfo=timezone.utc)
SIGNS = ["양자리", "황소자리", "쌍둥이자리", "게자리", "사자자리", "처녀자리",
         "천칭자리", "전갈자리", "사수자리", "염소자리", "물병자리", "물고기자리"]


def fmt(lon):
    return f"{lon:8.3f}° {SIGNS[int(lon // 30)]} {lon % 30:5.2f}°"


res = {}
# 1) pyswisseph 직접 (Moshier 내장 천체력 — ephe 파일 없이)
jd = swe.julday(1990, 5, 15, 1.5)
flags = swe.FLG_MOSEPH
bodies = {"Sun": swe.SUN, "Moon": swe.MOON, "Mercury": swe.MERCURY, "Venus": swe.VENUS,
          "Mars": swe.MARS, "Jupiter": swe.JUPITER, "Saturn": swe.SATURN}
res["swisseph"] = {k: swe.calc_ut(jd, v, flags)[0][0] for k, v in bodies.items()}
cusps, ascmc = swe.houses(jd, LAT, LON, b"P")
res["swisseph"]["ASC"] = ascmc[0]; res["swisseph"]["MC"] = ascmc[1]
sw_cusps = cusps

# 2) kerykeion (오프라인: 좌표·tz 직접)
from kerykeion import AstrologicalSubjectFactory
s = AstrologicalSubjectFactory.from_birth_data("A", 1990, 5, 15, 10, 30, lng=LON, lat=LAT,
                                               tz_str="Asia/Seoul", online=False)
res["kerykeion"] = {k: getattr(s, k.lower()).abs_pos for k in bodies}
res["kerykeion"]["ASC"] = s.ascendant.abs_pos if hasattr(s, "ascendant") else s.first_house.abs_pos
res["kerykeion"]["MC"] = s.medium_coeli.abs_pos if hasattr(s, "medium_coeli") else s.tenth_house.abs_pos
ky_houses = [getattr(s, n).abs_pos for n in ["first_house", "second_house", "third_house", "fourth_house",
             "fifth_house", "sixth_house", "seventh_house", "eighth_house", "ninth_house", "tenth_house",
             "eleventh_house", "twelfth_house"]]

# 3) skyfield (JPL DE421) — 행성 황경(겉보기, 시점 황도)
try:
    from skyfield.api import load
    from skyfield.framelib import ecliptic_frame
    ts = load.timescale()
    eph = load("de421.bsp")
    t = ts.from_datetime(UTC)
    earth = eph["earth"]
    names = {"Sun": "sun", "Moon": "moon", "Mercury": "mercury", "Venus": "venus", "Mars": "mars",
             "Jupiter": "jupiter barycenter", "Saturn": "saturn barycenter"}
    res["skyfield"] = {}
    for k, n in names.items():
        lat_, lon_, _ = earth.at(t).observe(eph[n]).apparent().frame_latlon(ecliptic_frame)
        res["skyfield"][k] = lon_.degrees
except Exception as e:
    print("skyfield 실패:", e)

# 4) flatlib (pyswisseph 2.10 위에서 동작 여부만)
try:
    from flatlib.datetime import Datetime
    from flatlib.geopos import GeoPos
    from flatlib.chart import Chart
    from flatlib import const
    ch = Chart(Datetime("1990/05/15", "10:30", "+09:00"), GeoPos(LAT, LON), hsys=const.HOUSES_PLACIDUS)
    res["flatlib"] = {k: ch.get(getattr(const, k.upper())).lon for k in bodies}
    res["flatlib"]["ASC"] = ch.get(const.ASC).lon; res["flatlib"]["MC"] = ch.get(const.MC).lon
except Exception as e:
    print("flatlib 실패:", type(e).__name__, e)

keys = list(bodies) + ["ASC", "MC"]
print(f"{'':8s}" + "".join(f"{e:>34s}" for e in res))
for k in keys:
    print(f"{k:8s}" + "".join(f"{fmt(res[e][k]) if k in res[e] else '-':>34s}" for e in res))
print("max |kerykeion - swisseph| deg:", max(abs(res['kerykeion'][k] - res['swisseph'][k]) for k in keys))
if "skyfield" in res:
    print("max |skyfield - swisseph| deg (행성):", max(abs((res['skyfield'][k] - res['swisseph'][k] + 180) % 360 - 180) for k in bodies))
print("Placidus 하우스 커스프(swisseph):", [round(c, 2) for c in sw_cusps])
print("Placidus 하우스 커스프(kerykeion):", [round(c, 2) for c in ky_houses])
# 행성이 들어간 하우스
def house_of(lon, cusps):
    for i in range(12):
        a, b = cusps[i], cusps[(i + 1) % 12]
        if (lon - a) % 360 < (b - a) % 360:
            return i + 1
for k in bodies:
    print(f"  {k}: {house_of(res['swisseph'][k], sw_cusps)}하우스")
