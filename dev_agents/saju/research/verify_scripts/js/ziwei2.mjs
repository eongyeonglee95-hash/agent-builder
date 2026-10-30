import { astro } from 'iztro';
const brief=(a)=>{const m=a.palaces.find(p=>p.name==='命宫'); return `음력 ${a.lunarDate} 命宮 ${m.heavenlyStem}${m.earthlyBranch} 주성[${m.majorStars.map(s=>s.name).join(',')}] ${a.fiveElementsClass}`};
// 1997-02-07 08:00: 한국음력 1996-12-30, 중국음력 1997-01-01
console.log('bySolar(중국음력 사용):', brief(astro.bySolar('1997-2-7',4,'女',true,'zh-CN')));
console.log('byLunar(한국음력 1996-12-30 입력):', brief(astro.byLunar('1996-12-30',4,'女',false,true,'zh-CN')));
