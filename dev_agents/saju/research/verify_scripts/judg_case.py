from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from lunar_python import Solar
from lunar_python.util import LunarUtil
SEOUL=ZoneInfo("Asia/Seoul"); CST=timezone(timedelta(hours=8))
local=datetime(1990,5,15,10,30)
cst=local.replace(tzinfo=SEOUL).astimezone(CST).replace(tzinfo=None)
ec=Solar.fromYmdHms(cst.year,cst.month,cst.day,cst.hour,cst.minute,0).getLunar().getEightChar()
print("원국",ec.getYear(),ec.getMonth(),ec.getDay(),ec.getTime())
for p in ("Year","Month","Day","Time"):
    print(p, getattr(ec,f"get{p}HideGan")(), getattr(ec,f"get{p}ShiShenGan")() if p!="Day" else "-", getattr(ec,f"get{p}ShiShenZhi")(), getattr(ec,f"get{p}DiShi")())
yun=ec.getYun(1,2)
print("대운 시작",yun.getStartYear(),yun.getStartMonth(),yun.getStartDay(),yun.getStartSolar().toYmdHms())
for d in yun.getDaYun()[:7]:
    print(d.getIndex(),d.getGanZhi(),d.getStartYear(),d.getEndYear(),d.getStartAge())
dm="庚"
def ss(g): return LunarUtil.SHI_SHEN.get(dm+g)
# 2027 year and months
for y in yun.getDaYun()[3].getLiuNian():
    if y.getYear()==2027: print("2027 세운",y.getGanZhi(), "대운",yun.getDaYun()[3].getGanZhi())
for y in yun.getDaYun()[4].getLiuNian()[:2]:
    print("다음대운 유년",y.getYear(),y.getGanZhi())
print("SHI_SHEN 丁",ss("丁"),"己",ss("己"),"乙",ss("乙"))
# month pillars 2027 with shishen & 12 stage
months=[("2027-02-04 10:46","壬寅"),("03-06","癸卯"),("04-05","甲辰"),("05-06","乙巳"),("06-06","丙午"),("07-07","丁未"),("08-08","戊申"),("09-08","己酉"),("10-08","庚戌"),("11-08","辛亥"),("12-07","壬子"),("2028-01-06","癸丑")]
zhs="子丑寅卯辰巳午未申酉戌亥"
# 12운성 for 庚: 장생 巳
stages=["장생","목욕","관대","건록","제왕","쇠","병","사","묘","절","태","양"]
def st(z): return stages[(zhs.index(z)-zhs.index("巳"))%12]
for d,gz in months:
    g,z=gz[0],gz[1]
    hide=LunarUtil.ZHI_HIDE_GAN[z]
    print(d,gz,"천간",ss(g),"지지본기",ss(hide[0]),"지장간",hide,[ss(h) for h in hide],"12운성",st(z))
print("未 12운성",st("未"),"申",st("申"),"酉",st("酉"))
