from lunar_python.util.LunarUtil import LunarUtil
from bazi.rules import BaziRules, DizhiRules, ShenshaRules, TianganRules
from bazi.defines import Tiangan, Dizhi, ShierZhangsheng, Ganzhi
G="甲乙丙丁戊己庚辛壬癸"; Z="子丑寅卯辰巳午未申酉戌亥"
WX={'甲':0,'乙':0,'丙':1,'丁':1,'戊':2,'己':2,'庚':3,'辛':3,'壬':4,'癸':4}
def tg(me,o):
    a,b=WX[me],WX[o]; same=(G.index(me)%2)==(G.index(o)%2)
    if a==b: return '비견' if same else '겁재'
    if (a+1)%5==b: return '식신' if same else '상관'
    if (a+2)%5==b: return '편재' if same else '정재'
    if (b+2)%5==a: return '편관' if same else '정관'
    if (b+1)%5==a: return '편인' if same else '정인'
K={'比肩':'비견','劫财':'겁재','食神':'식신','伤官':'상관','偏财':'편재','正财':'정재','七杀':'편관','正官':'정관','偏印':'편인','正印':'정인'}
mism=0
print("## 십신 100칸")
print("| 일간＼대상 | "+" | ".join(G)+" |")
for me in G:
    row=[]
    for o in G:
        mine=tg(me,o); lib=K[LunarUtil.SHI_SHEN[me+o]]
        if mine!=lib: mism+=1
        row.append(mine)
    print(f"| {me} | "+" | ".join(row)+" |")
print("mismatch vs lunar-python:",mism)
print("## 지지 본기 기준 십신")
benqi={z:max(BaziRules.HIDDEN_TIANGANS[Dizhi(z)].items(),key=lambda kv:kv[1])[0].value for z in Z}
print(benqi)
print("| 일간＼지지 | "+" | ".join(Z)+" |")
for me in G: print(f"| {me} | "+" | ".join(tg(me,benqi[z]) for z in Z)+" |")
print("lunar ZHI_HIDE_GAN 未:",LunarUtil.ZHI_HIDE_GAN.get('未'))
print("## 2027 丁未")
for me in G:
    hid=[h.value for h in BaziRules.HIDDEN_TIANGANS[Dizhi('未')]]
    print(me, tg(me,'丁'), [ (h,tg(me,h)) for h in hid])
# 12 stages
names=[str(s) for s in ShierZhangsheng]
print(names)
print("## 12운성 (bazi lib: 양순음역, 戊=丙,己=丁)")
print("| 일간＼지지 | "+" | ".join(Z)+" |")
rows={}
for t in G:
    row=BaziRules._ZHANGSHENG_ROWS[Tiangan(t)]
    m={d.value:names[i] for i,d in enumerate(row)}
    rows[t]=m
    print(f"| {t} | "+" | ".join(m[z] for z in Z)+" |")
# cross-check lunar-python
from lunar_python import Solar
# lunar util CHANG_SHENG offset table
print("lunar CHANG_SHENG:",LunarUtil.CHANG_SHENG, getattr(LunarUtil,'CHANG_SHENG_OFFSET',None))
off=LunarUtil.CHANG_SHENG_OFFSET
mm=0
for t in G:
    o=off[t]; yang=G.index(t)%2==0
    for z in Z:
        zi=Z.index(z)
        idx=(zi-o)%12 if yang else (o-zi)%12
        if LunarUtil.CHANG_SHENG[idx]!=rows[t][z].replace('长生','长生'): 
            mm+=1
print("12 stage mismatch lunar vs bazi:",mm)
print("未 col:",{t:rows[t]['未'] for t in G})
# 음양동생동사 alternative: yin stem uses yang partner's table
print("## 동생동사(음간=양간 표)")
for t in "乙丁己辛癸":
    p=G[G.index(t)-1]; print(t, rows[p]['未'])
# 水土同法: 戊 like 壬 (长生申)
print("水土同法 戊 at 未:", rows['壬']['未'], "己 (like 癸):", rows['癸']['未'])
