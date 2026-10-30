src=open("check_jieqi.py").read().replace("\nmain()\n","\n"); exec(src)
sj=sajupy_terms()
for y in (1990,2024):
  for lon,name in TERMS.items():
    s=swe_cross(lon,y)
    if s.year!=y: continue
    k=sj.get((y,name)) or sj.get((y,name.replace("淸","清")))
    print(y,name,"swe",s.astimezone(KST).strftime("%m-%d %H:%M"),"sajupy",k and k.strftime("%m-%d %H:%M"))
