const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number = value => value.toLocaleString('ko-KR', {maximumFractionDigits:1, minimumFractionDigits:1});
const signed = value => `${value > 0 ? '+' : ''}${number(value)}%`;
const months = ['6월','7월','8월','9월','10월','11월*'];
const change = a => a.base > 0 ? (a.count-a.base)/a.base*100 : null;
const seriesStyle = index => `--series:var(--cmp-series-${index+1})`;
const dash = index => ['','8 4','3 4','10 3 2 3'][index];
let activeComparison = null;

function transformed(a, mode) {
  return a.series.map(value => value === null ? null : mode === 'price' ? value :
    a.series[0] > 0 ? (value/a.series[0]-1)*100 : null);
}

function chart(list, state) {
  const mobile = window.innerWidth <= 600;
  const width = mobile ? 340 : 660;
  const height = mobile ? 230 : 270;
  const left = 44, right = width-16, top = 24, bottom = height-26;
  const values = list.flatMap(a => transformed(a, state.mode)).filter(v => v !== null);
  let low, high, step;
  if (state.mode === 'price') {
    step = 5;
    low = Math.floor((Math.min(...values)-1)/step)*step;
    high = Math.ceil((Math.max(...values)+1)/step)*step;
  } else {
    step = 5;
    low = Math.floor(Math.min(0,...values)/step)*step;
    high = Math.max(5,Math.ceil((Math.max(...values)+1)/step)*step);
  }
  const x = i => left+(right-left)*i/5;
  const y = value => bottom-(value-low)/(high-low)*(bottom-top);
  const ticks = [];
  for (let v=low; v<=high; v+=step) ticks.push(v);
  const paths = list.map((a,index) => {
    const vals = transformed(a,state.mode);
    const pieces = []; let piece=[];
    vals.forEach((value,i) => {
      if (value===null) { if(piece.length)pieces.push(piece);piece=[]; }
      else piece.push({x:x(i),y:y(value),value,i});
    });
    if(piece.length)pieces.push(piece);
    return `<g class="cmp-series" data-cmp-series="${a.id}" style="${seriesStyle(index)}">
      ${pieces.map(p=>`<polyline data-cmp-line="${a.id}" points="${p.map(v=>`${v.x},${v.y}`).join(' ')}" fill="none" stroke="var(--series)" stroke-width="3" stroke-dasharray="${dash(index)}" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`).join('')}
      ${pieces.flat().map(p=>`<circle cx="${p.x}" cy="${p.y}" r="3.5" fill="var(--card)" stroke="var(--series)" stroke-width="2" vector-effect="non-scaling-stroke"><title>${escape(a.name)} · ${months[p.i]} · ${state.mode==='price'?number(p.value)+'억':signed(p.value)}</title></circle>`).join('')}
    </g>`;
  }).join('');
  return `<svg class="cmp-chart" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="cmp-chart-title cmp-chart-desc">
    <title id="cmp-chart-title">${state.mode==='price'?'단지별 월별 매매 실거래 중간값':'6월 대비 단지별 월별 가격 변화율'}</title>
    <desc id="cmp-chart-desc">합성 예시. 6월부터 11월 9일까지, ${list.map(a=>a.name).join(', ')} 비교. 거래가 없는 달은 선을 잇지 않습니다. 아래 월 선택 버튼으로 정확한 값을 확인할 수 있습니다.</desc>
    ${ticks.map(v=>`<g><line x1="${left}" x2="${right}" y1="${y(v)}" y2="${y(v)}" class="cmp-gridline"/><text x="${left-10}" y="${y(v)+4}" text-anchor="end">${v}${state.mode==='price'?'':'%'}</text></g>`).join('')}
    <text x="${left}" y="12">${state.mode==='price'?'억 원':'6월 대비 %'}</text>
    <line class="cmp-guide" x1="${x(state.month)}" x2="${x(state.month)}" y1="${top}" y2="${bottom}"/>
    ${paths}
    ${months.map((m,i)=>`<rect data-cmp-month="${i}" class="cmp-hit" x="${Math.max(left,x(i)-(right-left)/10)}" y="${top}" width="${(right-left)/(i===0||i===5?10:5)}" height="${bottom-top}" fill="transparent"/><text x="${x(i)}" y="${height-7}" text-anchor="middle">${m.replace('*','')}</text>`).join('')}
  </svg>`;
}

function readout(list,state) {
  return list.map((a,index)=>{
    const v=transformed(a,state.mode)[state.month];
    return `<div class="cmp-readout-item" data-cmp-series="${a.id}" style="${seriesStyle(index)}"><span><i></i>${escape(a.name)}</span><b>${v===null?'거래 없음':state.mode==='price'?`${number(v)}<small>억</small>`:signed(v)}</b></div>`;
  }).join('');
}

function priceRanges(list) {
  const max=Math.ceil(Math.max(...list.map(a=>a.price))*1.1/10)*10;
  return `<section class="cmp-panel cmp-price-panel" aria-labelledby="cmp-price-title"><div class="cmp-panel-title"><div><p class="cmp-kicker">PRICE RANGE</p><h3 id="cmp-price-title">매매와 전세, 얼마나 다를까?</h3></div></div>
    <p class="cmp-period">최근 3개월 중간값 · 억 원</p>
    <div class="cmp-price-axis"><span>0</span><span>${max/2}</span><span>${max}</span></div>
    ${list.map((a,index)=>`<div class="cmp-price-row" data-cmp-series="${a.id}" style="${seriesStyle(index)}"><div class="cmp-row-title"><b>${escape(a.name)}</b><span>전세가율 ${(a.rent/a.price*100).toFixed(1)}%</span></div>
      <div class="cmp-range" role="img" aria-label="${a.name}, 전세 ${a.rent}억, 매매 ${a.price}억, 두 중간값 차이 ${(a.price-a.rent).toFixed(1)}억"><div class="cmp-range-track"></div><div class="cmp-range-span" style="left:${a.rent/max*100}%;width:${(a.price-a.rent)/max*100}%"></div><i class="cmp-range-dot rent" style="left:${a.rent/max*100}%"></i><i class="cmp-range-dot sale" style="left:${a.price/max*100}%"></i><span style="left:${a.rent/max*100}%">${number(a.rent)}</span><strong style="left:${a.price/max*100}%">${number(a.price)}</strong></div>
    </div>`).join('')}
    <div class="cmp-range-legend"><span><i class="rent"></i> 전세 중간값</span><span><i class="sale"></i> 매매 중간값</span></div>
    <p class="cmp-footnote">두 가격은 별도 거래 표본입니다. 연결된 길이는 두 중간값의 차이를 나타냅니다.</p>
  </section>`;
}

function inventory(list) {
  const max=Math.max(5,Math.ceil(Math.max(...list.map(a=>Math.abs(change(a)??0)))/5)*5);
  return `<section class="cmp-panel cmp-inventory" aria-labelledby="cmp-inventory-title"><div class="cmp-panel-title"><div><p class="cmp-kicker">LISTING CHANGE</p><h3 id="cmp-inventory-title">매물이 쌓이고 있나, 줄고 있나?</h3></div><span class="cmp-period">11.02 → 11.09 · 7일</span></div>
    <div class="cmp-inventory-axis"><span>감소 −${max}%</span><span>0</span><span>증가 +${max}%</span></div>
    ${list.map(a=>{const c=change(a);return `<div class="cmp-inventory-row" data-cmp-series="${a.id}"><b>${escape(a.name)}</b><div class="cmp-diverging" role="img" aria-label="${a.name}, ${a.base}건에서 ${a.count}건, ${c===null?'기준일 0건으로 증감률 계산 불가':signed(c)}"><i class="cmp-zero"></i>${c===null?'':`<div class="cmp-change-bar ${c<0?'down':'up'}" style="left:${c<0?50-Math.abs(c)/max*50:50}%;width:${Math.abs(c)/max*50}%"></div>`}</div><div class="cmp-change-value"><strong class="${c<0?'down':c>0?'up':''}">${c===null?'비교 불가':signed(c)}</strong><span>${a.base} → ${a.count}건</span></div></div>`}).join('')}
    <p class="cmp-footnote">같은 범위의 광고 수 비교입니다. 광고 감소가 거래 성사를 의미하지는 않습니다.</p>
  </section>`;
}

function visual(list,state) {
  const prices=list.map(a=>a.price),up=list.filter(a=>a.count>a.base).length,down=list.filter(a=>a.count<a.base).length;
  return `<section class="cmp-overview" aria-label="선택 단지 시각 비교"><div class="cmp-topline"><div><p class="cmp-kicker">COMPARE AT A GLANCE</p><h3>가격과 흐름, 한눈에 비교</h3></div><button class="text-link" data-cmp-table>상세 수치 보기 ↓</button></div>
    <p class="cmp-description">선택한 ${list.length}개 단지 · 전용 84㎡대 · 합성 예시 데이터</p>
    <div class="cmp-legend" aria-label="강조할 단지 선택">${list.map((a,index)=>`<button data-cmp-focus="${a.id}" style="${seriesStyle(index)}" aria-pressed="${state.focus===a.id}"><i></i>${escape(a.name)}<span>${a.area}㎡</span></button>`).join('')}<small>단지를 누르면 강조됩니다.</small></div>
    <div class="cmp-summary"><div><span>매매 중간값 범위</span><b>${number(Math.min(...prices))} <i>–</i> ${number(Math.max(...prices))}<small>억</small></b></div><div><span>7일간 매매 광고</span><b><em class="up">증가 ${up}</em><i>·</i><em class="down">감소 ${down}</em><small>곳</small></b></div><div><span>매매 거래 표본 · 최근 3개월</span><b>${list.reduce((sum,a)=>sum+a.n,0)}<small>건 / ${list.length}개 단지</small></b></div></div>
    <div class="cmp-visual-grid"><section class="cmp-panel cmp-trend" aria-labelledby="cmp-trend-title"><div class="cmp-panel-title"><div><p class="cmp-kicker">PRICE MOVEMENT</p><h3 id="cmp-trend-title">가격은 어떻게 움직였을까?</h3></div></div>
      <div class="cmp-trend-toolbar"><span class="cmp-period">2026.06 → 11.09 · 월별 중간값</span><div class="segmented">${[['price','가격'],['change','6월 대비 변화율']].map(([mode,title])=>`<button data-cmp-mode="${mode}" class="${state.mode===mode?'active':''}" aria-pressed="${state.mode===mode}">${title}</button>`).join('')}</div></div>
      ${chart(list,state)}
      <div class="cmp-months" aria-label="같은 달의 단지별 값 확인">${months.map((m,i)=>`<button data-cmp-month="${i}" aria-pressed="${state.month===i}" class="${state.month===i?'active':''}">${m}</button>`).join('')}</div>
      <div class="cmp-readout" aria-live="polite">${readout(list,state)}</div>
      <p class="cmp-footnote">${state.mode==='price'?'세로축은 선택한 단지의 가격 범위에 맞춥니다.':'각 단지의 6월 중간값을 기준으로 계산한 변화율입니다.'} *11월은 9일까지의 일부 기간이며, 거래 없는 달은 선을 잇지 않습니다.</p>
    </section>${priceRanges(list)}</div>${inventory(list)}
  </section>`;
}

export function mountComparison(root,list) {
  const state={mode:'price',focus:null,month:5};
  let small=window.innerWidth<=600;
  const syncFocus=()=>{
    root.querySelectorAll('[data-cmp-series]').forEach(el=>el.classList.toggle('cmp-muted',Boolean(state.focus&&el.dataset.cmpSeries!==state.focus)));
    root.querySelectorAll('[data-cmp-focus]').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.cmpFocus===state.focus)));
    root.parentElement.querySelectorAll('[data-cmp-col]').forEach(el=>el.classList.toggle('cmp-column-focus',el.dataset.cmpCol===state.focus));
  };
  const render=()=>{root.innerHTML=visual(list,state);syncFocus();};
  const setMonth=index=>{
    if(index===state.month)return;state.month=index;
    root.querySelector('.cmp-readout').innerHTML=readout(list,state);
    root.querySelectorAll('button[data-cmp-month]').forEach(el=>{const active=Number(el.dataset.cmpMonth)===index;el.setAttribute('aria-pressed',String(active));el.classList.toggle('active',active)});
    const width=small?340:660,x=44+(width-16-44)*index/5,guide=root.querySelector('.cmp-guide');
    guide.setAttribute('x1',x);guide.setAttribute('x2',x);syncFocus();
  };
  root.addEventListener('click',event=>{
    const button=event.target.closest('button');if(!button)return;
    if(button.dataset.cmpMode){state.mode=button.dataset.cmpMode;render();root.querySelector(`[data-cmp-mode="${state.mode}"]`).focus();}
    if(button.dataset.cmpFocus){state.focus=state.focus===button.dataset.cmpFocus?null:button.dataset.cmpFocus;syncFocus();}
    if(button.dataset.cmpMonth!==undefined)setMonth(Number(button.dataset.cmpMonth));
    if(button.hasAttribute('data-cmp-table')){const table=root.parentElement.querySelector('#cmp-detail-title');table.focus({preventScroll:true});table.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});}
  });
  root.addEventListener('pointerover',event=>{if(event.pointerType==='touch')return;const hit=event.target.closest('rect[data-cmp-month]');if(hit)setMonth(Number(hit.dataset.cmpMonth));});
  activeComparison={resize:()=>{if(!root.isConnected||!root.closest('dialog')?.open)return;const next=window.innerWidth<=600;if(next!==small){small=next;render();}}};
  render();
}

window.addEventListener('resize',()=>activeComparison?.resize());
