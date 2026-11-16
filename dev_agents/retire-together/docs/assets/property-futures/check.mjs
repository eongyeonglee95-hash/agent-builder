import { chromium } from '../../../web/node_modules/playwright/index.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url));
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1100},deviceScaleFactor:1});
const errors=[],writes=[],external=[],checks=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('request',r=>{if(!['GET','HEAD'].includes(r.method()))writes.push(r.url());if(r.url().startsWith('http')&&!r.url().startsWith('http://127.0.0.1:5180'))external.push(r.url());});
const url='http://127.0.0.1:5180/previews/property-futures.html';
const view=async name=>{if(name==='workbook'){if(!await page.locator('.market-tabs').count())await page.locator('.concept-nav [data-view="market"]').click();await page.locator('.market-tabs [data-view="workbook"]').click();}else await page.locator(`.concept-nav [data-view="${name}"]`).click();await page.locator(`#app[data-view="${name}"]`).waitFor();};
const close=async()=>{await page.keyboard.press('Escape');};
try {
 assert.equal((await page.goto(url)).status(),200);
 assert.equal(await page.locator('.concept-nav button').count(),3);
 assert.equal(await page.locator('.concept-nav [data-view="radar"]').count(),0);
 assert.equal(await page.locator('.district-tile').count(),25);
 const arithmetic=await page.evaluate(()=>{const stats=inventoryStats('서울 전체','sale');const before=districtData.reduce((a,d)=>a+d.sale[60],0),now=districtData.reduce((a,d)=>a+d.sale[90],0);return {before,now,stats};});
 assert.equal(await page.evaluate(()=>districtData.every(d=>[...d.sale,...d.rent].every(v=>Number.isInteger(v)&&v>0))),true);assert.equal(arithmetic.stats.now,arithmetic.now);assert.equal(arithmetic.stats.before,arithmetic.before);assert.equal(arithmetic.stats.delta,arithmetic.now-arithmetic.before);
 await page.locator('[data-inv-kind="rent"]').click();assert.equal(await page.locator('.inventory-series').count(),1);
 assert.match(await page.locator('.district-panel .eyebrow').innerText(),/LEASE/);
 await page.locator('[data-inv-period="7"]').click();assert.equal(await page.locator('.inventory-point').count(),7);
 await page.locator('[data-inv-scale="indexed"]').click();assert.match(await page.locator('.inventory-chart-empty').innerText(),/시작일의 관측이 누락/);
 await page.locator('.district-tile[data-district="서초구"]').click();assert.match(await page.locator('.inventory-trend h2').innerText(),/서초구/);assert.equal(await page.locator('.district-candidate').count(),2);
 await page.locator('[data-district-candidate="B"]').click();assert.equal(await page.locator('#app').getAttribute('data-view'),'workbook');assert.match(await page.locator('.obs-brief').innerText(),/잠원 리버테라스/);
 checks.push('Seoul 25 districts, sum-based changes, tenure/period/index filters and district-to-watchlist navigation');
 await view('market');await page.locator('#market-district-select').selectOption('강동구');assert.match(await page.locator('.district-breadcrumb').innerText(),/강동구/);assert.match(await page.locator('.inventory-trend h2').innerText(),/강동구/);
 await page.locator('.market-categories [data-district="강남구"]').click();assert.match(await page.locator('.district-breadcrumb').innerText(),/강남구/);
 checks.push('Market district categories precede data and full 25-district selector updates the observation scope');

 await view('market');await page.locator('[data-district="서울 전체"]').first().click();await page.locator('[data-inv-period="30"]').click();await page.locator('[data-inv-kind="both"]').click();
 await page.locator('#inventory-asof').selectOption('83');assert.match(await page.locator('.inventory-kpis').innerText(),/집계 보류/);assert.match(await page.locator('.collection-notice').innerText(),/송파구/);
 assert.equal(await page.evaluate(()=>inventoryTotal('서울 전체','sale',83)),null);
 await page.locator('#inventory-asof').selectOption('90');await page.locator('[data-inv-scale="count"]').click();
 assert.equal(await page.locator('.inventory-series').count(),2);
 assert.match(await page.locator('.inventory-series').first().getAttribute('d'),/M.*M/);
 await page.locator('.inventory-point').first().focus();await page.keyboard.press('Enter');assert.equal(await page.locator('#detail tbody tr').count(),25);await close();
 await page.locator('.collection-strip [data-action="collection"]').click();assert.match(await page.locator('#dialog-content').innerText(),/자동 수집은 미연결/);await close();
 checks.push('Partial collection withholds city sum, breaks chart lines, exposes dated evidence and collection status');
 await view('workbook');await page.locator('[data-watch-district="all"]').click();assert.equal(await page.locator('.quant-table tr[data-complex]').count(),6);assert.deepEqual(await page.locator('.quant-table .group-heading b').allTextContents(),['강남구','서초구','송파구','성동구','마포구']);
 await page.locator('#sample-filter').selectOption('10');assert.ok(await page.locator('.quant-table tr[data-complex]').count()<6);await page.locator('#sample-filter').selectOption('0');
 await page.locator('#factor-sort').selectOption('inventory');assert.match(await page.locator('.quant-table tr[data-complex]').first().innerText(),/대치 가든코트/);const order=await page.locator('.quant-table tr[data-complex]').evaluateAll(rows=>rows.map(r=>r.dataset.complex));assert.ok(order.indexOf('B')<order.indexOf('D'));
 assert.match(await page.locator('.quant-table tbody tr').filter({hasText:'잠실 레이크하우스'}).innerText(),/미확인/);
 await page.locator('#compare-factor-A').check();assert.match(await page.locator('.comparison-tray b').innerText(),/4/);
 await page.locator('[data-mode="history"]').click();assert.equal(await page.locator('#compare-history-A').isChecked(),true);
 for(const metric of ['sale','rent','ratio','gap','per']){await page.locator(`[data-metric="${metric}"]`).click();assert.equal(await page.locator('.history-table tr[data-complex]').count(),6);}
 await page.locator('[data-history="B:23"]').click();assert.match(await page.locator('#dialog-content').innerText(),/공급 33평/);await close();await page.locator('[data-mode="factors"]').click();
 checks.push('Workbook sample/sort/missing-data controls, five monthly metrics and shared checkbox basket');
 await page.locator('[data-watch-district="송파구"]').click();assert.equal(await page.locator('.quant-table tr[data-complex]').count(),1);assert.match(await page.locator('.quant-summary>div').nth(1).innerText(),/—/);
 await page.locator('[data-watch-district="서초구"]').click();assert.equal(await page.locator('.quant-table tr[data-complex]').count(),2);assert.equal(await page.locator('#group-factor-서초구').evaluate(el=>el.indeterminate),true);
 await page.locator('[data-mode="history"]').click();assert.equal(await page.locator('.history-table .workbook-group').count(),1);assert.equal(await page.locator('.history-table tr[data-complex]').count(),2);
 await page.locator('[data-mode="factors"]').click();await page.locator('[data-watch-district="all"]').click();
 checks.push('Workbook district grouping in both modes, within-district sorting and unavailable inventory remains unknown');

 await view('relative');assert.equal(await page.locator('.comparison-option input:checked').count(),4);assert.equal(await page.locator('.multi-chart-panel .chart-legend span').count(),4);
 assert.equal(await page.locator('#group-picker-서초구').evaluate(el=>el.indeterminate),true);
 await page.locator('[data-watch-district="서초구"]').click();assert.equal(await page.locator('.rail-complexes').count(),1);assert.equal(await page.locator('.comparison-option').count(),2);
 await page.locator('#group-picker-서초구').check();assert.deepEqual(await page.evaluate(()=>[...state.compare].sort()),['A','B','C','D','E']);
 await page.locator('[data-watch-district="송파구"]').click();await page.locator('#group-picker-송파구').check();assert.equal(await page.locator('.multi-chart-panel .chart-legend span').count(),6);
 await page.locator('[data-watch-district="강남구"]').click();assert.equal(await page.locator('.comparison-option').count(),1);assert.match(await page.locator('.district-category-panel .note').innerText(),/다른 구에서 선택한 5개/);
 await page.locator('[data-compare-remove="E"]').click();assert.equal(await page.locator('#compare-picker-E').isChecked(),false);assert.equal(await page.locator('.multi-chart-panel .chart-legend span').count(),5);
 await page.locator('[data-watch-district="all"]').click();
 checks.push('District-first categories, mixed group checkboxes, cross-district selection persistence and grouped basket removal');
 await page.locator('[data-action="compare-all"]').click();assert.deepEqual(await page.locator('.comparison-district-band th:not(:first-child)').evaluateAll(a=>a.map(el=>el.childNodes[0].textContent)),['강남구','서초구','송파구','성동구','마포구']);assert.equal(await page.locator('.comparison-matrix .complex-head th').count(),7);
 await page.locator('[data-compare-metric="rent"]').click();await page.locator('[data-chart="raw"]').click();assert.match(await page.locator('.multi-chart-panel h2').innerText(),/전세/);
 await page.locator('[data-chart="ratio"]').click();await page.locator('#benchmark-select').selectOption('E');assert.equal(await page.evaluate(()=>state.benchmark),'E');
 await page.locator('#compare-picker-E').uncheck();assert.notEqual(await page.evaluate(()=>state.benchmark),'E');assert.equal(await page.locator('.multi-chart-panel .chart-legend span').count(),5);
 await page.locator('[data-action="compare-clear"]').click();assert.equal(await page.locator('.comparison-empty').count(),1);assert.equal(await page.locator('.comparison-matrix').count(),0);
 await page.locator('#compare-picker-B').check();assert.equal(await page.locator('.multi-chart-panel .chart-legend span').count(),1);
 await page.locator('#compare-picker-C').check();await page.locator('#compare-picker-E').check();
 await page.locator('[data-chart="indexed"]').click();await page.locator('[data-compare-metric="sale"]').click();await page.locator('[data-period="24"]').click();
 const all=await page.locator('.scatter-chart circle').count();await page.locator('[data-floor="middle"]').click();const filtered=await page.locator('.scatter-chart circle').count();assert.ok(filtered>0&&filtered<all);
 await page.locator('.scatter-chart circle').first().focus();await page.keyboard.press('Enter');assert.match(await page.locator('#dialog-content').innerText(),/최초 관측일/);await close();await page.locator('[data-floor="all"]').click();
 checks.push('Multi-complex checkbox selection 0/1/3/6, benchmark removal, metric/period charts, matrix and filtered trade evidence');
 await page.locator('.distribution-panel [data-detail="E"]').click();await page.locator('.integrated-note[data-case="permit"]').click();
 assert.match(await page.locator('.research-separation').innerText(),/예산 편성은 집행 완료가 아니고/);
 await page.locator('[data-task="permit"]').check();await page.locator('[data-signal-source="1"]').click();assert.match(await page.locator('#dialog-content').innerText(),/가상 기록/);await close();
 await view('journal');assert.equal(await page.locator('[data-task="permit"]').isChecked(),true);
 assert.match(await page.locator('.journal-market').innerText(),/10.30/);const published=await page.locator('.revision-panel').innerText();await page.locator('[data-asof="latest"]').click();assert.notEqual(await page.locator('.revision-panel').innerText(),published);
 await page.locator('[data-frequency="week"]').click();assert.match(await page.locator('.journal-market').innerText(),/2026-11-07/);assert.equal(await page.locator('.weekly-event').count(),4);
 await page.locator('.weekly-event[data-case="permit"]').click();assert.equal(await page.locator('#app').getAttribute('data-view'),'journal');assert.equal(await page.locator('[data-task="permit"]').last().isChecked(),true);await close();
 await page.locator('#report-note').fill('서울 전세 광고와 세 단지의 흐름을 함께 관찰');await page.locator('[data-frequency="month"]').click();assert.equal(await page.locator('#report-note').inputValue(),'서울 전세 광고와 세 단지의 흐름을 함께 관찰');
 await page.locator('[data-action="export"]').click();assert.match(await page.locator('#report-export').inputValue(),/합성 자료/);const download=page.waitForEvent('download');await page.locator('[data-action="download"]').click();assert.match((await download).suggestedFilename(),/가상예시.txt$/);await close();
 checks.push('Integrated research notes without standalone radar, counterevidence, carried tasks, report revisions and export');
 for(const width of [1440,1024,768,390,360]){
  await page.setViewportSize({width,height:width<600?900:1100});
  for(const name of ['market','workbook','relative','journal']){
   await view(name);const size=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,width:innerWidth}));assert.ok(size.scroll<=size.width+1,`${name} ${width}: ${size.scroll}`);checks.push(`${name} ${width}px layout`);
   if(width===1440||width===390)await page.screenshot({path:path.join(dir,`${name}-${width}.png`),fullPage:true});
  }
  if(width===390){
   await view('relative');await page.locator('[data-watch-district="서초구"]').click();assert.equal(await page.locator('#compare-picker-D').isVisible(),true);await page.locator('#compare-picker-D').check();
   await page.locator('[data-watch-district="송파구"]').click();assert.equal(await page.locator('#compare-picker-F').isVisible(),true);assert.equal(await page.evaluate(()=>state.compare.includes('D')),true);
   await page.locator('[data-compare-remove="D"]').click();await page.locator('[data-watch-district="all"]').click();assert.equal(await page.locator('#compare-picker-B').isVisible(),false);assert.equal(await page.locator('.multi-chart-panel .chart-legend span').count(),3);
   await page.locator('.prototype-note [data-action="dictionary"]').click();assert.match(await page.locator('#dialog-content').innerText(),/정량 지표/);await close();
   checks.push('Mobile district expansion, checkbox selection across districts, basket removal and accessible metric definitions');
  }
  await page.locator('[data-action="research"]').click();for(const tab of ['services','design']){await page.locator(`[data-research="${tab}"]`).click();assert.equal(await page.locator('#detail').evaluate(el=>el.scrollWidth>el.clientWidth+1),false,`research ${tab} ${width}`);}await close();checks.push(`service and design notes ${width}px`);
  await view('market');await page.locator('.collection-strip [data-action="collection"]').count()&&width>820?await page.locator('.collection-strip [data-action="collection"]').click():await page.locator('.collection-strip [data-action="collection"]').click();assert.equal(await page.locator('#detail').evaluate(el=>el.scrollWidth>el.clientWidth+1),false,`collection ${width}`);await close();checks.push(`collection evidence ${width}px`);
  await view('relative');await page.locator('.distribution-panel [data-detail="E"]').click();await page.locator('.integrated-note[data-case="permit"]').click();assert.equal(await page.locator('#detail').evaluate(el=>el.scrollWidth>el.clientWidth+1),false,`integrated note ${width}`);await close();checks.push(`integrated research ${width}px`);
 }
 assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);assert.deepEqual(external,[]);
 const result={checked_at:new Date().toISOString(),url,checks,evidence:arithmetic,errors,writes,external,limits:['Synthetic daily inventory and complex data; no live collection or model calls','Daily collection design only; no scheduled task created','Pages embedded renderer not checked by local Playwright']};await fs.writeFile(path.join(dir,'verification.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({checks:checks.length,errors,writes,external,passed:true}));
}catch(error){await page.screenshot({path:path.join(dir,'failure.png'),fullPage:true});console.error(JSON.stringify({errors,writes,external,failure:String(error)}));throw error;}finally{await browser.close();}
