from bazi.defines.dizhi import Dizhi
from bazi.defines.tiangan import Tiangan
from bazi.utils import dizhi_utils, tiangan_utils
def D(s): return [Dizhi.from_str(c) for c in s]
def T(s): return [Tiangan.from_str(c) for c in s]
def fmt(disc): return {str(k):[ "".join(sorted(str(x) for x in c)) for c in v] for k,v in disc.items()}
yuan_z="午巳辰巳"; yuan_t="庚辛庚辛"
print("원국 지지 내부", fmt(dizhi_utils.discover(D(yuan_z))))
print("원국 천간 내부", fmt(tiangan_utils.discover(T(yuan_t))))
for name,gz in [("세운","丁未"),("대운甲申","甲申"),("대운乙酉","乙酉")]:
    print(name, "지지", fmt(dizhi_utils.discover_mutual(D(yuan_z),D(gz[1]))), "천간", fmt(tiangan_utils.discover_mutual(T(yuan_t),T(gz[0]))))
for dy in ["甲申","乙酉"]:
    print("세운+대운",dy,"지지(원국+대운+세운 중 세운 참여)", fmt(dizhi_utils.discover_mutual(D(yuan_z+dy[1]),D("未"))), "천간", fmt(tiangan_utils.discover_mutual(T(yuan_t+dy[0]),T("丁"))))
for m in ["壬寅","癸卯","甲辰","乙巳","丙午","丁未","戊申","己酉","庚戌","辛亥","壬子","癸丑"]:
    print("월",m, "지지 vs 원국+세운", fmt(dizhi_utils.discover_mutual(D(yuan_z+"未"),D(m[1]))), "천간", fmt(tiangan_utils.discover_mutual(T(yuan_t+"丁"),T(m[0]))))
