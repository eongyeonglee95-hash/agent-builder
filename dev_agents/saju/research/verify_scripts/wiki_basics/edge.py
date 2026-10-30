from lunar_python import Solar
def bz(y,m,d,h,mi,sect=2, kst=True):
    # KST -> CST(UTC+8): subtract 1h
    import datetime as dt
    t = dt.datetime(y,m,d,h,mi)-(dt.timedelta(hours=1) if kst else dt.timedelta(0))
    ec = Solar.fromYmdHms(t.year,t.month,t.day,t.hour,t.minute,0).getLunar().getEightChar()
    ec.setSect(sect)
    return ' '.join([ec.getYear(),ec.getMonth(),ec.getDay(),ec.getTime()])
print("2027-02-04 10:40 KST", bz(2027,2,4,10,40))
print("2027-02-04 10:50 KST", bz(2027,2,4,10,50))
print("1995-11-20 23:40 sect2", bz(1995,11,20,23,40,2))
print("1995-11-20 23:40 sect1", bz(1995,11,20,23,40,1))
print("2027-03-15 12:00", bz(2027,3,15,12,0))
print("1995-11-20 23:40 local sect2", bz(1995,11,20,23,40,2,kst=False))
print("1995-11-20 23:40 local sect1", bz(1995,11,20,23,40,1,kst=False))
print("1995-11-21 00:20 local sect2", bz(1995,11,21,0,20,2,kst=False))
