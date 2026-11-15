// 합성 시안 자료. 실거래·실시간 매물·사용자 자산 자료가 아닙니다.
export const dates = ['2026-08-11','2026-09-30','2026-10-10','2026-10-31','2026-11-02','2026-11-09'];
const rows = [
 ['강남구',6230,8.4,13.2,20.1],['서초구',4810,5.7,9.8,15.6],['송파구',5820,6.2,11.2,17.1],
 ['강동구',3240,-4.8,-8.1,-12.3],['마포구',2480,-6.2,-11.3,-14.2],['성동구',2180,-3.5,-7.5,-9.4],
 ['용산구',1870,3.2,5.9,8.2],['양천구',3140,4.5,7.8,11.4],['영등포구',2910,2.8,6.1,9.8],
 ['동작구',2260,-2.4,-5.1,-8.6],['노원구',4670,9.2,14.5,22.4],['은평구',2710,4.2,8.9,13.2],
 ['강서구',3830,7.1,12.4,19.2],['관악구',2160,3.5,6.5,10.4],['성북구',2870,5.1,9.7,13.6],
 ['동대문구',2460,-1.8,-4.2,-7.1],['서대문구',1860,-0.6,-2.1,-4.3],['중랑구',2220,6.5,11.8,15.4],
 ['도봉구',1740,4.6,8.1,12.3],['강북구',1320,2.1,4.7,7.6],['구로구',2510,3.8,6.9,10.2],
 ['금천구',1120,-3.2,-6.8,-8.9],['광진구',1580,-4.1,-7.6,-10.8],['종로구',740,0.4,1.2,3.1],['중구',820,-0.9,-2.4,-4.6],
];
export const districts=rows.map(([name,count,w,m,q],i)=>({id:i,name,
 sale:[Math.round(count/(1+q/100)),Math.round(count/(1+(m+1.6)/100)),Math.round(count/(1+m/100)),Math.round(count/(1+(w+0.7)/100)),Math.round(count/(1+w/100)),count],
 rent:[0,1,2,3,4,5].map(j=>Math.round(count*.37*(1+(5-j)*((i%5)-2)*.018))),
}));
export const apartments=[
 {id:'els',name:'잠실엘스',district:'송파구',dong:'잠실동',year:2008,homes:5678,area:84.8,price:27.8,rent:12.2,count:84,base:78,n:9,group:'핵심 관심',tag:'매물 증가',series:[25.2,25.6,25.3,26.5,26.2,27.8]},
 {id:'raemian',name:'래미안대치팰리스',district:'강남구',dong:'대치동',year:2015,homes:1608,area:84.9,price:36.4,rent:17.2,count:46,base:40,n:4,group:'핵심 관심',tag:'새 실거래',series:[33.1,33.4,34.6,34.2,35.6,36.4]},
 {id:'banpo',name:'반포자이',district:'서초구',dong:'반포동',year:2009,homes:3410,area:84.9,price:38.2,rent:16.5,count:65,base:61,n:6,group:'핵심 관심',tag:'매물 증가',series:[35.2,35.8,35.5,36.9,37.2,38.2]},
 {id:'godeok',name:'고덕그라시움',district:'강동구',dong:'고덕동',year:2019,homes:4932,area:84.2,price:18.4,rent:8.6,count:52,base:57,n:11,group:'비교 후보',tag:'매물 감소',series:[17.4,17.6,17.5,18.1,17.9,18.4]},
 {id:'mapo',name:'마포래미안푸르지오',district:'마포구',dong:'아현동',year:2014,homes:3885,area:84.5,price:20.8,rent:9.4,count:39,base:43,n:7,group:'비교 후보',tag:'매물 감소',series:[19.2,19.5,19.8,19.6,20.4,20.8]},
 {id:'trimage',name:'트리마제',district:'성동구',dong:'성수동',year:2017,homes:688,area:84.8,price:35.6,rent:15.2,count:18,base:19,n:2,group:'장기 관찰',tag:'표본 적음',series:[32.9,33.6,null,34.2,null,35.6]},
 {id:'ricenz',name:'리센츠',district:'송파구',dong:'잠실동',year:2008,homes:5563,area:84.9,price:27.5,rent:12.1,count:76,base:70,n:8,group:'비교 후보',tag:'매물 증가',series:[24.6,25.2,25.5,26.0,26.8,27.5]},
 {id:'acriver',name:'아크로리버파크',district:'서초구',dong:'반포동',year:2016,homes:1612,area:84.9,price:45.2,rent:19.6,count:36,base:32,n:3,group:'장기 관찰',tag:'새 실거래',series:[41.5,42.1,null,43.6,44.2,45.2]},
];
export const readings=[
 {name:'KB 주택가격동향',type:'주간 · 월간',scope:'지역 가격·수급의 기준선',url:'https://data.kbland.kr/kbstats/wmh',status:'원문 연결'},
 {name:'한국부동산원 R-ONE',type:'주간 · 월간',scope:'가격·거래·공급의 교차 확인',url:'https://www.reb.or.kr/r-one/portal/bbs/rpt/searchBulletinPage.do',status:'원문 연결'},
 {name:'KB 주택시장 리뷰',type:'월간',scope:'매매·임대·분양·금융을 함께 읽기',url:'https://www.kbfg.com/kbresearch/report/reportView.do?reportId=2001362',status:'2026.10월호'},
 {name:'이상우 부동산라이프',type:'월간지',scope:'전문가의 가설을 내 관측과 대조',url:'https://invaid.cafe24.com/',status:'본문 미확인'},
 {name:'국토연구원 소비심리지수',type:'월간',scope:'소비자 심리와 거래의 차이 읽기',url:'https://kremap.krihs.re.kr/write/SystemIntro?kind=54',status:'원문 연결'},
 {name:'국토교통부 통계누리',type:'월간',scope:'인허가·착공·준공·미분양 구분',url:'https://stat.molit.go.kr/portal/main/portalMain.do',status:'원문 연결'},
];
