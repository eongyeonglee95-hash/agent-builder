import { astro } from 'iztro';
const show=(lang,date,ti,g)=>{
  const a = astro.bySolar(date, ti, g, true, lang);
  console.log(`--- ${lang} ${date} timeIndex=${ti} ${g}`);
  console.log('음력',a.lunarDate,'| 간지',a.chineseDate,'| 시',a.time,a.timeRange,'| 오행국',a.fiveElementsClass,'| 명주',a.soul,'신주',a.body,'| 命宮지지',a.earthlyBranchOfSoulPalace,'身宮지지',a.earthlyBranchOfBodyPalace);
  for (const p of a.palaces) {
    const ms=p.majorStars.map(s=>s.name+(s.brightness?`(${s.brightness})`:'')+(s.mutagen?`[${s.mutagen}]`:'')).join(' ');
    console.log(`  ${p.name.padEnd(4)} ${p.heavenlyStem}${p.earthlyBranch}${p.isBodyPalace?' 身':''} | ${ms} | 대한 ${p.decadal.range.join('-')}`);
  }
  // 2027 운세: horoscope
  const h=a.horoscope('2027-03-01');
  console.log('  2027-03-01 유년(流年)', h.yearly.heavenlyStem+h.yearly.earthlyBranch, '유년 사화',h.yearly.mutagen.join(','), '| 대한',h.decadal.heavenlyStem+h.decadal.earthlyBranch, h.decadal.name);
};
show('zh-CN','1990-5-15',5,'男');
show('ko-KR','1990-5-15',5,'男');
show('zh-CN','1975-8-25',7,'男');
