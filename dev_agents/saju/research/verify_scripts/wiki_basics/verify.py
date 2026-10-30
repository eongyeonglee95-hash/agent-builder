from lunar_python import Solar, Lunar
from lunar_python.util import LunarUtil as U
print("GAN", U.GAN[1:]); print("ZHI", U.ZHI[1:])
print("WU_XING_GAN", U.WU_XING_GAN); print("WU_XING_ZHI", U.WU_XING_ZHI)
print("ZHI_HIDE_GAN", U.ZHI_HIDE_GAN)
print("SHENGXIAO", U.SHENGXIAO[1:])
jz = U.JIA_ZI
print(len(jz))
for i,g in enumerate(jz):
    print(i+1, g, U.NAYIN[g])
# month heads: for each year stem, find month stems of 寅月 by computing a real year
import itertools
print("--- month stems by year stem (from real years) ---")
for y in range(2020,2030):
    s = Solar.fromYmdHms(y,3,1,12,0,0)  # after 立春, in 寅 or 卯 month
    l = s.getLunar()
    s2 = Solar.fromYmdHms(y,2,20,12,0,0).getLunar()
    print(y, l.getYearInGanZhiExact(), "Feb20 month:", s2.getMonthInGanZhiExact())
print("--- hour stems by day stem ---")
d = Solar.fromYmdHms(2027,1,1,0,30,0)
for k in range(10):
    s = Solar.fromJulianDay(d.getJulianDay()+k)
    out=[]
    for h in [0,1,3,5,7,9,11,13,15,17,19,21,23]:
        x = Solar.fromYmdHms(s.getYear(),s.getMonth(),s.getDay(),h,30,0).getLunar()
        out.append(x.getTimeInGanZhi())
    print(s.toYmd(), Solar.fromYmdHms(s.getYear(),s.getMonth(),s.getDay(),12,0,0).getLunar().getDayInGanZhiExact(), out)
