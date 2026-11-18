// Design-only fixtures. No values in this module are market observations or ledger inputs.
(() => {
const byId=id=>document.getElementById(id);
const years=Array.from({length:11},(_,i)=>2016+i);
const series=[
 {id:'home',name:'실거주 아파트 · 예시',area:84,values:[8,8.6,9.2,10.4,12,14.2,13.7,12.6,14.4,15.1,16],purchase:{year:2019,price:10}},
 {id:'second',name:'다른 보유 주택 · 예시',area:59,values:[4,4.1,4.6,4.8,5.4,6.3,6,5.6,5.9,6.1,6.5]},
 {id:'daechi84',name:'대치미도',area:84,values:[13,14.1,16.3,18,20.4,24.2,23,24.3,27.2,31,33.8]},
 {id:'banpo84',name:'반포자이',area:84,values:[16,17.4,19.2,21,24.3,28.5,27.2,29.1,32.5,36.8,40.5]},
 {id:'dogok59',name:'도곡렉슬',area:59,values:[10,10.8,12.2,14,16,19.4,18.5,null,21.6,23.9,25.7]},
];
let mode='price';const chosen=new Set(['daechi84','banpo84']);
byId('benchmark').innerHTML=`<div class="section-head"><div><h2>내 집을 기준으로, 시장의 흐름을 비교</h2><p class="caption">모든 시계열·매입가는 가상 예시입니다. 실제 데이터 미연결.</p></div><span class="tag">연간 비교 시안</span></div>
<div class="benchmark-controls"><label>기준 아파트<select id="base-home">${series.map(s=>`<option value="${s.id}">${s.name} · ${s.area}㎡</option>`).join('')}</select></label><label>비교 기간<select id="range"><option value="1">최근 1년</option><option value="3">최근 3년</option><option value="5" selected>최근 5년</option><option value="10">최근 10년</option><option value="custom">직접 지정</option></select></label><label id="start-wrap" hidden>시작연도<select id="start-year">${years.map(y=>`<option ${y===2021?'selected':''}>${y}</option>`).join('')}</select></label><label id="end-wrap" hidden>종료연도<select id="end-year">${years.map(y=>`<option ${y===2026?'selected':''}>${y}</option>`).join('')}</select></label><div class="period" role="group" aria-label="비교 방식"><button data-mode="price" aria-pressed="true">가격</button><button data-mode="index" aria-pressed="false">시작점 100</button><button data-mode="gap" aria-pressed="false">가격 차액</button></div></div>
<fieldset class="compare-picks"><legend>비교 단지 · 평형 고정</legend>${series.slice(2).map(s=>`<label><input type="checkbox" data-series="${s.id}" ${chosen.has(s.id)?'checked':''}>${s.name} · ${s.area}㎡</label>`).join('')}</fieldset>
<p id="range-error" role="alert" hidden>시작연도는 종료연도보다 빨라야 합니다.</p><div id="chart-legend" class="chart-legend"></div><div class="chart-shell"><svg id="trend-chart" viewBox="0 0 1000 300" role="img" aria-label="가상 시계열 비교 그래프"></svg></div><p id="trend-caption" class="caption"></p><details class="chart-data"><summary>비교 수치 보기 · 가상 자료</summary><div class="scroll"><table id="trend-data"></table></div></details>`;
function render(){
 const base=series.find(s=>s.id===byId('base-home').value),custom=byId('range').value==='custom';
 byId('start-wrap').hidden=byId('end-wrap').hidden=!custom;
 const end=custom?Number(byId('end-year').value):2026,start=custom?Number(byId('start-year').value):end-Number(byId('range').value);
 byId('range-error').hidden=start<end;
 if(start>=end){byId('trend-chart').innerHTML='';byId('chart-legend').textContent='';byId('trend-data').innerHTML='';byId('trend-caption').textContent='기간을 다시 선택해 주세요.';return}
 const indices=years.map((y,i)=>({y,i})).filter(d=>d.y>=start&&d.y<=end);
 const active=[base,...series.filter(s=>chosen.has(s.id)&&s.id!==base.id)];
 const palettes=['var(--brand)','var(--acct-2)','var(--grey-700)','var(--cls-property)'];
 const datasets=active.map((s,j)=>({s,color:palettes[j],values:indices.map(({i})=>{const n=s.values[i],b=base.values[i],first=s.values[indices[0].i];return n==null?null:mode==='price'?n:mode==='index'?first==null?null:n/first*100:b==null?null:n-b})}));
 const valid=datasets.flatMap(d=>d.values.filter(v=>v!=null));
 const purchase=base.purchase&&base.purchase.year>=start&&base.purchase.year<=end&&mode==='price'?base.purchase:null;
 if(purchase)valid.push(purchase.price);
 const min=valid.length?Math.min(...valid):0,max=valid.length?Math.max(...valid):1,pad=Math.max((max-min)*.13,1),lo=min-pad,hi=max+pad;
 const x=y=>62+(y-start)/(end-start)*910,y=v=>244-(v-lo)/(hi-lo)*210;
 const unit=mode==='index'?'지수':'억원';
 let svg='<title>가상 연간 가격 흐름 · '+start+'–'+end+'</title><desc>실제 시세가 아닌 인터랙션 시안입니다. 결측 구간은 연결하지 않습니다. 아래 비교 수치 표에서 같은 데이터를 확인할 수 있습니다.</desc>';
 for(let i=0;i<5;i++){const v=lo+(hi-lo)*i/4;svg+=`<line x1="62" y1="${y(v)}" x2="972" y2="${y(v)}" stroke="var(--border)"/><text x="48" y="${y(v)+4}" text-anchor="end">${v.toFixed(1)}</text>`}
 indices.forEach(({y:yr},i)=>{if(indices.length<8||i%2===0||i===indices.length-1)svg+=`<text x="${x(yr)}" y="274" text-anchor="middle">${yr}</text>`});
 datasets.forEach(({s,color,values},j)=>{let path='',connected=false;values.forEach((v,i)=>{if(v==null){connected=false;return}path+=(connected?'L':'M')+x(indices[i].y)+','+y(v)+' ';connected=true});svg+=`<path d="${path}" stroke="${color}" stroke-width="${j===0?3:2}" ${j===2?'stroke-dasharray="6 4"':''} fill="none"/>`;values.forEach((v,i)=>{if(v!=null)svg+=`<circle cx="${x(indices[i].y)}" cy="${y(v)}" r="3.5" fill="${color}"><title>${s.name} ${indices[i].y}년: ${v.toFixed(1)} ${unit} · 가상 자료</title></circle>`})});
 if(purchase)svg+=`<line x1="${x(purchase.year)}" y1="22" x2="${x(purchase.year)}" y2="244" stroke="var(--grey-700)" stroke-dasharray="3 5"/><circle cx="${x(purchase.year)}" cy="${y(purchase.price)}" r="6" fill="var(--background)" stroke="var(--grey-900)" stroke-width="2"/><text x="${x(purchase.year)+8}" y="17">매입 ${purchase.price}억 · 예시</text>`;
 byId('trend-chart').innerHTML=svg;
 byId('chart-legend').innerHTML=datasets.map((d,j)=>`<span><i style="background:${d.color}"></i>${j===0?'기준 · ':''}${d.s.name} ${d.s.area}㎡</span>`).join('');
 byId('trend-caption').textContent=mode==='gap'?'목표 단지 − 기준 집 · 매수 부대비용과 세금은 제외':'기간 '+start+'–'+end+' · '+(mode==='index'?'동일 시작연도 = 100 · 시작 자료가 없으면 해당 지수 미표시':'가상 연간 가격 · 호가와 실제 매입가는 별도 데이터로 연결 예정');
 byId('trend-data').innerHTML='<thead><tr><th>연도</th>'+datasets.map(d=>'<th>'+d.s.name+' ('+unit+')</th>').join('')+'</tr></thead><tbody>'+indices.map(({y:yr},i)=>'<tr><td>'+yr+'</td>'+datasets.map(d=>'<td>'+(d.values[i]==null?'자료 없음':d.values[i].toFixed(1))+'</td>').join('')+'</tr>').join('')+'</tbody>';
}
byId('benchmark').addEventListener('change',e=>{if(e.target.dataset.series)e.target.checked?chosen.add(e.target.dataset.series):chosen.delete(e.target.dataset.series);render()});
byId('benchmark').addEventListener('click',e=>{const b=e.target.closest('[data-mode]');if(!b)return;mode=b.dataset.mode;document.querySelectorAll('[data-mode]').forEach(el=>el.setAttribute('aria-pressed',el.dataset.mode===mode));render()});
byId('market-pulse').innerHTML=`<div class="section-head"><div><h2>시장의 협상력</h2><p class="caption">가격 흐름과 수급을 함께 확인</p></div><label>지역 <select id="pulse-region"><option>강남</option><option>서초</option><option>서울</option></select></label></div><div class="pulse-summary"><strong id="pulse-state">강남 · 판단 보류</strong><span>지역별 수급 자료 연결 전</span></div><div class="pulse-grid">${[['매수·매도 수급','공표된 수급 지표 · 출처의 기준 적용'],['거래량','같은 지역의 전월·전년 동기 비교'],['매물 수','중복 제거 후 신규·회수·누적 매물'],['호가 조정','동일 매물의 인하·인상 기록']].map(([label,desc])=>`<div><h3>${label}</h3><strong>자료 없음</strong><p>${desc}</p><small>지역 범위·기준일·출처 확인 전</small></div>`).join('')}</div><p class="caption">지표가 엇갈리거나 지역별 근거가 부족하면 단일 매수/매도 우위로 확정하지 않습니다.</p>`;
byId('pulse-region').onchange=()=>byId('pulse-state').textContent=byId('pulse-region').value+' · 판단 보류';
render();
})();
