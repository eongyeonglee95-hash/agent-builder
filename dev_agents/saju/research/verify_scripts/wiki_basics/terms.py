from lunar_python import Solar
from datetime import datetime, timedelta
l = Solar.fromYmd(2027,6,1).getLunar()
t = l.getJieQiTable()
rows=[]
for name, s in t.items():
    dt = datetime(s.getYear(),s.getMonth(),s.getDay(),s.getHour(),s.getMinute(),s.getSecond())+timedelta(hours=1)
    rows.append((dt,name))
for dt,name in sorted(rows):
    if datetime(2026,12,1)<=dt<=datetime(2028,1,31):
        # ganzhi month right after (in CST)
        c = dt - timedelta(hours=1) + timedelta(minutes=5)
        lu = Solar.fromYmdHms(c.year,c.month,c.day,c.hour,c.minute,0).getLunar()
        print(dt.strftime('%Y-%m-%d %H:%M:%S'), name, lu.getYearInGanZhiExact(), lu.getMonthInGanZhiExact())
for d in [(2027,2,4),(2027,1,1),(2027,12,31)]:
    lu=Solar.fromYmdHms(*d,12,0,0).getLunar(); print(d, lu.getDayInGanZhiExact(), lu.getYearInGanZhiExact(), lu.getYearInGanZhi())
# 2027 lunar new year
print(Solar.fromYmd(2027,2,6).getLunar().toString(), Solar.fromYmd(2027,2,7).getLunar().toString())
