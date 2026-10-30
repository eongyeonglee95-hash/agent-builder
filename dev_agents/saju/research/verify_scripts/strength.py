# 신강·신약 점수 예시: 여러 가중 방식으로 같은 원국을 계산 (사례 A)
EL={'甲':'木','乙':'木','丙':'火','丁':'火','戊':'土','己':'土','庚':'金','辛':'金','壬':'水','癸':'水'}
ZB={'子':['癸'],'丑':['己','癸','辛'],'寅':['甲','丙','戊'],'卯':['乙'],'辰':['戊','乙','癸'],'巳':['丙','庚','戊'],
    '午':['丁','己'],'未':['己','丁','乙'],'申':['庚','壬','戊'],'酉':['辛'],'戌':['戊','辛','丁'],'亥':['壬','甲']}
ZEL={'子':'水','丑':'土','寅':'木','卯':'木','辰':'土','巳':'火','午':'火','未':'土','申':'金','酉':'金','戌':'土','亥':'水'}
GEN={'木':'火','火':'土','土':'金','金':'水','水':'木'}
def helps(dm_el,e): # 비겁 or 인성
    return e==dm_el or GEN[e]==dm_el
chart={'yg':'庚','yz':'午','mg':'辛','mz':'巳','dg':'庚','dz':'辰','hg':'辛','hz':'巳'}
dm=chart['dg']; de=EL[dm]
# 방식1: 8글자 동등(일간 제외 7글자), 지지는 본기 오행
def s1():
    items=[EL[chart[k]] for k in ('yg','mg','hg')]+[ZEL[chart[k]] for k in ('yz','mz','dz','hz')]
    h=sum(helps(de,e) for e in items); return h,len(items)
# 방식2: 위치 가중(예시) 월지3 일지2 나머지 지지1 천간1 — 지지는 본기
def s2(w={'yg':1,'mg':1,'hg':1,'yz':1,'mz':3,'dz':2,'hz':1}):
    tot=sum(w.values()); h=0
    for k,v in w.items():
        e=EL[chart[k]] if k.endswith('g') else ZEL[chart[k]]
        h+=v*helps(de,e)
    return h,tot
# 방식3: 지장간 분할(본기 0.6 중기 0.3 여기 0.1 근사) + 월지 x2
def s3():
    ratio={1:[1.0],2:[0.7,0.3],3:[0.6,0.3,0.1]}
    h=t=0
    for k in ('yg','mg','hg'):
        t+=1; h+=helps(de,EL[chart[k]])
    for k,m in (('yz',1),('mz',2),('dz',1),('hz',1)):
        hs=ZB[chart[k]]; r=ratio[len(hs)]
        for g,x in zip(hs,r):
            t+=x*m; h+=x*m*helps(de,EL[g])
    return round(h,2),round(t,2)
# 득령·득지·득세 3요소
mz_main=EL[ZB[chart['mz']][0]]; dz_main=EL[ZB[chart['dz']][0]]
deukryeong=helps(de,mz_main); deukji=helps(de,dz_main)
others=[EL[chart[k]] for k in ('yg','mg','hg')]+[ZEL[chart[k]] for k in ('yz','hz')]
deukse=sum(helps(de,e) for e in others) > len(others)/2
print("득령",deukryeong,"(월지 본기",mz_main,")","득지",deukji,"(일지 본기",dz_main,")","득세",deukse, others)
for n,f in (("방식1 동등",s1),("방식2 위치가중",s2),("방식3 지장간+월지x2",s3)):
    h,t=f(); print(n,h,"/",t,"=",round(h/t,3))
# 월지 巳 중기 庚(비견) 고려 시
print("월지 巳 지장간",ZB['巳'],"→ 중기 庚 비견. 12운성 장생")
