from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from lunar_python import Solar
from bazi.bazi import Bazi
from bazi.bazi_chart import BaziChart
from bazi.school import BaziConfig, BaziPrecision
from bazi.calendar import CalendarBackend
import itertools
SEOUL=ZoneInfo("Asia/Seoul"); CST=timezone(timedelta(hours=8))
cases=[("A",datetime(1990,5,15,10,30),1),("B2",datetime(1990,2,4,11,30),0),("C",datetime(1987,7,20,5,20),1),("G",datetime(1975,8,25,13,15),1),("H",datetime(1988,3,3,8,0),0)]
for cid,local,g in cases:
    cst=local.replace(tzinfo=SEOUL).astimezone(CST).replace(tzinfo=None)  # 절기 비교를 절대시각으로
    ec=Solar.fromYmdHms(cst.year,cst.month,cst.day,cst.hour,cst.minute,0).getLunar().getEightChar()
    out=[]
    for sect in (1,2):
        y=ec.getYun(g,sect)
        dys=[d.getGanZhi() for d in y.getDaYun()[1:6]]
        out.append(f"sect{sect}: {y.getStartYear()}년{y.getStartMonth()}개월{y.getStartDay()}일 시작양력 {y.getStartSolar().toYmd()} 첫대운나이(lunar-python 세는나이) {y.getDaYun()[1].getStartAge()} {dys}")
    cfg=BaziConfig(precision=BaziPrecision.MINUTE, backend=CalendarBackend.CELESTIAL)
    b=Bazi.create(cst,"male" if g else "female",cfg)
    ch=BaziChart(b)
    d=list(itertools.islice(ch.dayun,5))
    gap_days=(ch.dayun_start_moment-cst)/timedelta(days=365)*3
    print(cid,local,"남" if g else "여","원국",ec.getYear(),ec.getMonth(),ec.getDay(),ec.getTime(),"| 순행" if ch.dayun_order else "| 역행")
    for o in out: print("   lunar-python",o)
    print("   bazi lib: 교운 시각",ch.dayun_start_moment.strftime("%F %H:%M"),"(UTC+8) 절기까지 %.2f일 → %.2f년"%(gap_days,gap_days/3),[str(x.ganzhi) for x in d])
