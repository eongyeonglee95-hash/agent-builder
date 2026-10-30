from lunar_python.EightChar import EightChar
from bazi.rules import BaziRules
from bazi.defines import Tiangan, ShierZhangsheng
G="甲乙丙丁戊己庚辛壬癸"; Z="子丑寅卯辰巳午未申酉戌亥"
off=EightChar._EightChar__CHANG_SHENG_OFFSET; CS=EightChar.CHANG_SHENG
names=[str(s) for s in ShierZhangsheng]
mm=[]
for gi,t in enumerate(G):
    row=BaziRules._ZHANGSHENG_ROWS[Tiangan(t)]; m={str(d):names[i] for i,d in enumerate(row)}
    for zi,z in enumerate(Z):
        idx=(off[t]+(zi if gi%2==0 else -zi))%12
        if CS[idx]!=m[z]: mm.append((t,z,CS[idx],m[z]))
print(len(mm), mm[:30])
