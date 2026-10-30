from bazi.rules import BaziRules, DizhiRules as D, ShenshaRules as S, TianganRules as T
from bazi.defines import Tiangan, Dizhi, Ganzhi
G="甲乙丙丁戊己庚辛壬癸"; Z="子丑寅卯辰巳午未申酉戌亥"
W=Dizhi('未')
def fs(*a): return frozenset(Dizhi(x) for x in a)
print("## 未 x 지지")
for z in Z:
    d=Dizhi(z); r=[]
    p=frozenset((W,d))
    if p in D.DIZHI_LIUHE: r.append(f"육합({D.DIZHI_LIUHE[p]})")
    if p in D.DIZHI_BANHE: r.append(f"반합({D.DIZHI_BANHE[p]})")
    if p in D.DIZHI_GONGHE[D.GongheDef.NARROW]: r.append(f"공합/拱合 narrow→{D.DIZHI_GONGHE[D.GongheDef.NARROW][p]}")
    if p in D.DIZHI_GONGHUI: r.append(f"拱会→{D.DIZHI_GONGHUI[p]}")
    for k,v in D.DIZHI_SANHUI.items():
        if W in k and d in k and d!=W: r.append(f"방합일부({''.join(str(x) for x in k)} {v})")
    for k,v in D.DIZHI_SANHE.items():
        if W in k and d in k and d!=W: r.append(f"삼합일부({''.join(str(x) for x in k)} {v})")
    if p in D.DIZHI_CHONG: r.append("충")
    if p in D.DIZHI_PO: r.append("파")
    if p in D.DIZHI_HAI: r.append("해")
    for defn in D.XingDef:
        t=D.DIZHI_XING[defn]
        if (W,d) in t or (d,W) in t: r.append(f"형[{defn.name}:{(W,d) in t and 'W->d' or 'd->W'}]")
    for defn in D.AnheDef:
        if p in D.DIZHI_ANHE[defn]: r.append(f"암합[{defn.name}]")
    print(z, r)
print("## 천간 합/충")
for k,v in T.TIANGAN_HE.items(): print(''.join(str(x) for x in k),v)
print([''.join(str(x) for x in k) for k in T.TIANGAN_CHONG])
print("丁 with each stem:",[(g, (frozenset((Tiangan('丁'),Tiangan(g))) in T.TIANGAN_HE), frozenset((Tiangan('丁'),Tiangan(g))) in T.TIANGAN_CHONG) for g in G])
print("## 12신살 table")
seq=["겁살","재살","천살","지살","년살(도화)","월살","망신","장성","반안","역마","육해","화개"]
groups={"申子辰":"巳","寅午戌":"亥","亥卯未":"申","巳酉丑":"寅"}
tab={}
for g,start in groups.items():
    s=Z.index(start); row={seq[i]:Z[(s+i)%12] for i in range(12)}
    tab[g]=row; print(g,row)
    # verify vs bazi
    for z in g:
        assert S.JIESHA[Dizhi(z)]==Dizhi(row["겁살"]); assert S.ZAISHA[Dizhi(z)]==Dizhi(row["재살"])
        assert S.TAOHUA[Dizhi(z)]==Dizhi(row["년살(도화)"]); assert S.WANGSHEN[Dizhi(z)]==Dizhi(row["망신"])
        assert S.JIANGXING[Dizhi(z)]==Dizhi(row["장성"]); assert S.YIMA[Dizhi(z)]==Dizhi(row["역마"]); assert S.HUAGAI[Dizhi(z)]==Dizhi(row["화개"])
print("verified 7 of 12 vs bazi lib")
print("未 as target:",{g:[k for k,v in tab[g].items() if v=='未'] for g in groups})
print("## stem-based shinsal hitting 未")
for defn in S.TianyiDef: print("천을",defn.name,[g for g in G if W in S.TIANYI[defn][Tiangan(g)]])
for defn in S.YangrenDef: print("양인",defn.name,{g:str(S.YANGREN[defn][Tiangan(g)]) for g in G})
for defn in S.WenchangDef: print("문창",defn.name,{g:str(S.WENCHANG[defn][Tiangan(g)]) for g in G})
print("홍염",{g:str(S.HONGYAN[Tiangan(g)]) for g in G})
print("금여",{g:str(S.JINYU[Tiangan(g)]) for g in G})
print("홍란 target 未 year:",[z for z in Z if S.HONGLUAN[Dizhi(z)]==W], "천희:",[z for z in Z if S.TIANXI[Dizhi(z)]==W])
print("홍란",{z:str(S.HONGLUAN[Dizhi(z)]) for z in Z})
print("고신",[z for z in Z if S.GUCHEN[Dizhi(z)]==W],"과숙",[z for z in Z if S.GUASU[Dizhi(z)]==W])
print("## 공망")
for head in ["甲子","甲戌","甲申","甲午","甲辰","甲寅"]:
    gz=Ganzhi.from_str(head); members=[str(gz.next(i)) for i in range(10)]
    print(head, ''.join(str(x) for x in sorted(S.KONGWANG[gz],key=lambda d:d.index)), ' '.join(members))
print("丁未 공망:",sorted(str(x) for x in S.KONGWANG[Ganzhi.from_str('丁未')]))
print("未 공망 day pillars:",[str(gz) for gz in S.KONGWANG if W in S.KONGWANG[gz]])
print("괴강",[str(x) for x in S.KUIGANG])
