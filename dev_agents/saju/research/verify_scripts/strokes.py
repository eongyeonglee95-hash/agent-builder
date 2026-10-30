import re,sys
d={};rad={};kr={}
for f in ["unihan/Unihan_IRGSources.txt","unihan/Unihan_Readings.txt"]:
    for line in open(f,encoding="utf-8"):
        if line.startswith("#") or not line.strip(): continue
        cp,key,val=line.rstrip("\n").split("\t")
        ch=chr(int(cp[2:],16))
        if key=="kTotalStrokes": d[ch]=val
        if key=="kRSUnicode": rad[ch]=val
        if key=="kHangul": kr[ch]=val
for ch in sys.argv[1]:
    print(ch, "kTotalStrokes(필획)=",d.get(ch),"부수.나머지획=",rad.get(ch),"한글음=",kr.get(ch))
