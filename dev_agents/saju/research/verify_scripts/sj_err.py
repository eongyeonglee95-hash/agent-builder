import importlib.util,sys
spec=importlib.util.spec_from_file_location("cj","check_jieqi.py")
src=open("check_jieqi.py").read().replace("\nmain()\n","\n")
exec(src)
sj=sajupy_terms()
from collections import defaultdict
b=defaultdict(list)
for y in range(1920,2051):
  for lon,name in TERMS.items():
    s=swe_cross(lon,y)
    if s.year!=y: continue
    k=sj.get((y,name)) or sj.get((y,name.replace("淸","清")))
    if k: b[y//10*10].append(abs((k-s).total_seconds())/60)
for d in sorted(b): v=b[d]; print(d, len(v), "max %.1f분"%max(v), ">2분 %d건"%sum(x>2 for x in v))
