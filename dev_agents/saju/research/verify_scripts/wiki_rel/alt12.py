from bazi.rules import BaziRules
from bazi.defines import Tiangan, ShierZhangsheng
from lunar_python import Solar
G="甲乙丙丁戊己庚辛壬癸"
names=[str(s) for s in ShierZhangsheng]
def at(t,z):
    row=BaziRules._ZHANGSHENG_ROWS[Tiangan(t)]
    return names[[str(d) for d in row].index(z)]
print("std(火土,양순음역):",{t:at(t,'未') for t in G})
print("水土同法: 戊->壬 표",at('壬','未'),"己->癸 표",at('癸','未'))
print("음양동생동사(음간=양간 표):",{t:at(G[G.index(t)-1],'未') for t in "乙丁己辛癸"})
l=Solar.fromYmdHms(2027,6,1,12,0,0).getLunar(); print("2027-06-01 year pillar:",l.getYearInGanZhiExact())
l=Solar.fromYmdHms(2027,2,4,10,40,0).getLunar(); print("2027-02-04 10:40:",l.getYearInGanZhiExact())
l=Solar.fromYmdHms(2027,2,4,10,50,0).getLunar(); print("2027-02-04 10:50:",l.getYearInGanZhiExact())
