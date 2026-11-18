const homes = [
  {id:'daechi',name:'대치미도',region:'강남',area:84,ask:34.9,trade:33.8,condition:'층·동 확인'},
  {id:'eunma',name:'대치은마',region:'강남',area:76,ask:29.5,trade:29,condition:'입주일 확인'},
  {id:'dogok',name:'도곡렉슬',region:'강남',area:59,ask:26,trade:25.7,condition:'임차 조건'},
  {id:'banpo',name:'반포자이',region:'서초',area:84,ask:41.2,trade:40.5,condition:'층·향 확인'},
  {id:'mido',name:'반포미도',region:'서초',area:84,ask:38.2,trade:37.9,condition:'면적 대조'},
  {id:'maple',name:'메이플자이',region:'서초',area:59,ask:36.8,trade:36.2,condition:'매물 유효 여부'},
];
const $ = s => document.querySelector(s);
let selected='daechi',period='week';
const saved=new Set(['daechi','mido']),notes={},checks={};
const titles={scanner:['매물을 찾고, 근거를 확인하세요.','강남·서초 · 같은 면적의 가격 비교부터'],research:['단지 하나를, 깊이 이해하기.','거래 조건과 내 판단을 한곳에 기록'],plan:['강남·서초로 가는 선택지.','내 자금, 매물 조건, 세금의 적용 시점을 함께']};
const reports={
 week:[
  ['market','매물','이번 주 새 매물·호가 변경','같은 매물인지 대조한 뒤, 이전/이번 확인일의 호가와 입주 조건을 비교합니다. 중복 광고·가격 변경·매물 회수를 구분합니다.','국토부 실거래','https://rt.molit.go.kr/'],
  ['tax','취득','취득 단계의 세법·정책 변경','변경 내용 → 발표일/시행일 → 적용 대상 → 내 주택 수·계약 시점과의 관계를 정리합니다. 발표된 안과 시행 중인 제도를 구분합니다.','위택스','https://www.wetax.go.kr/'],
  ['tax','양도','현재 집 매도에 영향을 주는 조건','보유·거주 기간, 지분, 매도/매수 순서를 확인합니다. 변경 원문과 적용 조건을 대조하고 불명확한 부분은 세무 확인 질문으로 남깁니다.','국가법령정보센터','https://www.law.go.kr/'],
  ['tax','보유','재산세·종부세 확인 사항','과세 기준일·공시가격·공제 조건의 변경을 분리해 기록합니다. 우리 집에 해당하는지 확인된 내용과 추가 확인할 내용을 나눕니다.','국세청','https://www.nts.go.kr/'],
 ],
 month:[
  ['market','가격','한 달간 같은 조건의 가격 흐름','동일 단지·면적의 거래 수, 가격 범위, 반복 매물의 호가 변화를 비교합니다. 조건이 다른 거래는 분리하고 자료가 부족하면 추세를 확정하지 않습니다.','국토부 실거래','https://rt.molit.go.kr/'],
  ['market','검증','지난 판단과 실제 확인 결과','처음 적은 가설 → 후속 확인 → 유지/수정한 판단을 연결합니다. 급매라고 생각한 이유가 확인됐는지, 반복 광고였는지 기록합니다.','국토부 실거래','https://rt.molit.go.kr/'],
  ['tax','세금','발표·시행·적용 시점 정리','월중 발표된 안과 확정·시행된 제도를 구분합니다. 취득/보유/양도 단계별로 이번 달 변경과 다음 달 확인할 날짜를 묶습니다.','국가법령정보센터','https://www.law.go.kr/'],
  ['tax','자금','갈아타기 자금과 세금 조건 재점검','매도 순자금·매수 부대비용·대출 조건을 다시 확인합니다. 공제나 특례는 적용 근거가 확인됐을 때만 반영하고, 미확인 조건을 나열합니다.','국세청','https://www.nts.go.kr/'],
 ]
};
function renderReports(){
 const date=new Date($('#report-date').value+'T12:00:00');
 if(!Number.isNaN(date.valueOf())){const start=new Date(date),end=new Date(date);if(period==='week'){start.setDate(date.getDate()-((date.getDay()+6)%7));end.setTime(start.getTime());end.setDate(start.getDate()+6)}else{start.setDate(1);end.setMonth(end.getMonth()+1,0)}const fmt=d=>d.getFullYear()+'.'+String(d.getMonth()+1).padStart(2,'0')+'.'+String(d.getDate()).padStart(2,'0');$('#date-range').textContent=fmt(start)+' – '+fmt(end)}

 $('#report-title').textContent=period==='week'?'이번 주, 달라진 것':'한 달을 모아, 판단을 점검';
 $('#report-description').textContent=period==='week'?'새로운 근거와 이번 주 확인할 일.':'누적된 변화와 지난 가설의 검증 결과.';
 document.querySelectorAll('[data-period]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.period===period));
 $('#report-items').innerHTML=reports[period].filter(r=>$('#topic').value==='all'||r[0]===$('#topic').value).map(r=>'<div class="report-item"><span class="tag">'+r[1]+'</span><details><summary>'+r[2]+'</summary><p>'+r[3]+'</p><dl class="report-facts"><div><dt>제도 상태</dt><dd>원문 확인 전</dd></div><div><dt>발표일 / 시행일</dt><dd>확인 전</dd></div><div><dt>내 조건 적용</dt><dd>검토 전</dd></div></dl><a href="'+r[5]+'" target="_blank" rel="noreferrer">'+r[4]+' · 공식 확인 창구</a></details><small>조사 전</small></div>').join('');
}
function renderDetail(){const h=homes.find(h=>h.id===selected);
 $('#scanner-detail').innerHTML='<h2>'+h.name+'</h2><p class="caption">선택한 단지 · 가상 비교 자료</p><dl><div><dt>전용면적</dt><dd>'+h.area+'㎡</dd></div><div><dt>호가 / 실거래</dt><dd>'+h.ask+' / '+h.trade+'억</dd></div></dl><div><h3>다음 확인</h3><p class="caption">'+h.condition+' · 계약일 대조</p><button data-open-research>단지 리서치 열기</button></div>';
 $('#research-top').innerHTML='<div class="section-head"><h2>'+h.name+'</h2><span>'+h.region+' · 전용 '+h.area+'㎡</span></div><dl><div><dt>매물 호가</dt><dd>'+h.ask+'억</dd></div><div><dt>비교 실거래</dt><dd>'+h.trade+'억</dd></div><div><dt>판단 상태</dt><dd>조건 확인 전</dd></div></dl><p class="caption">모든 가격은 디자인용 가상 자료</p>';
}
function pick(id){selected=id;renderDetail();$('#note').value=notes[id]||'';$('#status').textContent='';document.querySelectorAll('[data-pick]').forEach(b=>b.classList.toggle('active',b.dataset.pick===id));document.querySelectorAll('.checklist input').forEach((el,i)=>el.checked=!!checks[id]?.[i]);}
function renderRows(){const term=$('#search').value.replace(/\s/g,'');const rows=homes.filter(h=>h.name.includes(term)&&($('#region').value==='전체'||h.region===$('#region').value)&&(!$('#saved-only').checked||saved.has(h.id))).sort((a,b)=>$('#sort').value==='price'?a.ask-b.ask:a.name.localeCompare(b.name,'ko'));
 $('#rows').innerHTML=rows.map(h=>'<tr><td><button class="pick" data-pick="'+h.id+'">'+h.name+'</button><small>'+h.region+' · '+h.area+'㎡</small></td><td class="number">'+h.ask+'억<small>11.17 확인 · 예시</small></td><td class="number">'+h.trade+'억<small>11.09 계약 · 12층 · 예시</small></td><td><span class="tag">'+h.condition+'</span></td><td><button class="save" data-save="'+h.id+'" aria-label="'+h.name+' 후보 저장" aria-pressed="'+saved.has(h.id)+'">'+(saved.has(h.id)?'저장됨':'저장')+'</button></td></tr>').join('')||'<tr><td colspan="5" class="empty">조건에 맞는 단지가 없습니다.</td></tr>';
 $('#count').textContent=rows.length+'곳 표시 · '+saved.size+'곳 저장';
}
function show(view){$('#shell').className='shell '+view;['scanner','research','plan'].forEach(v=>$('#'+v).hidden=v!==view);document.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.view===view));$('#title').textContent=titles[view][0];$('#subtitle').textContent=titles[view][1];history.replaceState(null,'','#'+view);renderDetail();$('#count').hidden=view!=='scanner';}
$('#shortlist').innerHTML=homes.map(h=>'<button data-pick="'+h.id+'">'+h.name+'<small>'+h.region+' · '+h.area+'㎡</small></button>').join('');
$('#targets').innerHTML=homes.filter(h=>['daechi','banpo','mido'].includes(h.id)).map(h=>'<article class="target"><div><h3>'+h.name+'</h3><small>'+h.region+' · 전용 '+h.area+'㎡</small></div><div><small>호가 · 예시</small><strong>'+h.ask+'억</strong></div><div><small>취득·양도세</small><strong>조건 확인 전</strong></div><button data-target="'+h.id+'">근거 보기</button></article>').join('');
document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.view)show(b.dataset.view);if(b.dataset.pick)pick(b.dataset.pick);if(b.dataset.save){saved.has(b.dataset.save)?saved.delete(b.dataset.save):saved.add(b.dataset.save);renderRows()}if(b.hasAttribute('data-open-research'))show('research');if(b.dataset.target){pick(b.dataset.target);show('research')}if(b.dataset.period){period=b.dataset.period;renderReports()}});
$('#search').addEventListener('input',e=>{if(!e.isComposing)renderRows()});$('#search').addEventListener('compositionend',renderRows);['region','sort','saved-only'].forEach(id=>$('#'+id).addEventListener('change',renderRows));$('#save-note').onclick=()=>{notes[selected]=$('#note').value;$('#status').textContent='이 시안에 기록했습니다. 새로고침하면 초기화됩니다.'};$('#topic').onchange=renderReports;$('#report-date').onchange=renderReports;
document.querySelectorAll('.checklist input').forEach((el,i)=>el.addEventListener('change',()=>{checks[selected]??=[];checks[selected][i]=el.checked}));
renderRows();pick(selected);renderReports();show(['scanner','research','plan'].includes(location.hash.slice(1))?location.hash.slice(1):'scanner');
