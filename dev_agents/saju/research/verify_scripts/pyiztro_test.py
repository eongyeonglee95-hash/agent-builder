from py_iztro import Astro
a=Astro().by_solar("1990-5-15",5,"男",True,"zh-CN")
print("py-iztro:",a.lunar_date,a.chinese_date,a.five_elements_class,a.soul,a.body)
for p in a.palaces: print(" ",p.name,p.heavenly_stem+p.earthly_branch,[s.name for s in p.major_stars])
