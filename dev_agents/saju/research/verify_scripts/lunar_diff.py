from korean_lunar_calendar import KoreanLunarCalendar
from lunar_python import Solar
from datetime import date, timedelta
import csv, pathlib, sajupy
sj={}
for r in csv.DictReader(open(pathlib.Path(sajupy.__file__).parent/"calendar_data.csv")):
    sj[(int(r["year"]),int(r["month"]),int(r["day"]))]=(int(r["lunar_year"]),int(r["lunar_month"]),int(r["lunar_day"]))
c=KoreanLunarCalendar()
d=date(1900,1,31); end=date(2050,12,31)
diffs=[]; sjd=0; n=0
while d<=end:
    c.setSolarDate(d.year,d.month,d.day)
    k=(c.lunarYear,c.lunarMonth,c.lunarDay,c.isIntercalation)
    l=Solar.fromYmd(d.year,d.month,d.day).getLunar()
    m=l.getMonth(); ch=(l.getYear(),abs(m),l.getDay(),m<0)
    if k!=ch: diffs.append((d,k,ch))
    s=sj.get((d.year,d.month,d.day))
    if s and s!=k[:3]: sjd+=1
    n+=1; d+=timedelta(days=1)
print("days",n,"KR(korean-lunar-calendar) vs CN(lunar-python) differ:",len(diffs))
# group into runs
runs=[]; 
for x in diffs:
    if runs and (x[0]-runs[-1][-1][0]).days==1: runs[-1].append(x)
    else: runs.append([x])
print("runs",len(runs))
for r in runs: print(r[0][0], "~", r[-1][0], len(r),"일 | KR",r[0][1],"CN",r[0][2])
print("sajupy lunar vs korean-lunar-calendar mismatch days:",sjd)
