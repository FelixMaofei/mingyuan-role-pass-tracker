import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';

export const uid=prefix=>`${prefix}-${randomUUID()}`;
export function initializeControl(data,members){
  const next=structuredClone(data);
  next.control??={version:2,cutoff:{period:239,month:'2026-07'},trackingSince:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),people:[],calendar:[],monthChecks:[],openings:[],grants:[],uses:[],rates:[],passDates:[],settlementChecks:[],audit:[]};
  bindPeople(next,members);
  for(const r of next.records){
    r.personId??=next.control.people.find(p=>p.name===r.name)?.id;
    r.sources??={attendance:r.source&&r.attendance!=='未记录'?[r.source]:[],roles:r.source&&r.roles.length?[r.source]:[],awards:r.source&&r.awards.length?[r.source]:[]};
    for(const a of r.awards)a.id??=uid('award');
  }
  for(const b of next.baselines)b.personId??=next.control.people.find(p=>p.name===b.name)?.id;
  for(const r of next.records.filter(r=>typeof r.period==='number')){
    if(!next.control.calendar.some(m=>m.period===r.period))next.control.calendar.push({period:r.period,date:r.date,status:'已开会',source:r.source||'既有逐期记录'});
  }
  return next;
}
// 改名沿用官网编号或已确认别名；无法对应时停止，不新造第二个账户。
export function bindPeople(data,members){
  if(!data.control)return;
  const people=data.control.people;
  for(const m of members){
    const names=[m.name,...m.aliases];
    const matches=people.filter(p=>(m.number&&p.number===m.number)||[p.name,...p.aliases].some(n=>names.includes(n)));
    if(matches.length>1)throw new Error(`会员身份对应多个人：${m.name}`);
    let p=matches[0];
    if(!p){
      p={id:uid('person'),name:m.name,number:m.number||'',aliases:[...m.aliases]};people.push(p);
      if(data.control.rates.length&&m.joined&&m.joined.slice(0,7)>data.control.cutoff.month){
        for(const kind of ['最佳','全勤','通关'])data.control.openings.push({personId:p.id,kind,earnedCents:0,usedCents:0,source:`会员库确认${m.joined}入会，晚于旧奖励核算范围`,settlementSource:'入会前无本会奖励',facts:kind==='最佳'?{awardIds:[]}:kind==='全勤'?{months:[]}:{passes:0}});
        if(m.joined>data.control.trackingSince)data.control.settlementChecks.push({personId:p.id,through:data.control.trackingSince,source:'接管奖励记录之后新入会，无接管前使用'});
      }
    }
    else{
      p.aliases=[...new Set([...p.aliases,p.name,...m.aliases])].filter(n=>n!==m.name);
      p.name=m.name;if(m.number)p.number=m.number;
    }
  }
  for(const p of people)if(!members.some(m=>m.name===p.name))throw new Error(`会员库找不到已有账户“${p.name}”；改名请保留原名为别名，离会请保留会员记录`);
  for(const list of [data.records,data.baselines])for(const r of list){
    const p=r.personId?people.find(p=>p.id===r.personId):people.find(p=>p.name===r.name||p.aliases.includes(r.name));
    if(!p)throw new Error(`历史记录身份无法对应：${r.name}`);
    r.personId=p.id;r.name=p.name;
  }
}
export function personFor(data,name){
  const p=data.control?.people.find(p=>p.name===name||p.aliases.includes(name)||p.id===name);
  if(!p)throw new Error(`无法识别奖励账户：${name}`);
  return p;
}
export function auditChange(before,after,action,source){
  if(!after.control)return after;
  const changes=[];
  for(const section of ['records','baselines']){
    const key=r=>section==='records'?`${r.personId||r.name}|${r.period}`:r.personId||r.name;
    const a=new Map(before[section].map(r=>[key(r),r])),b=new Map(after[section].map(r=>[key(r),r]));
    for(const id of new Set([...a.keys(),...b.keys()]))if(!isDeepStrictEqual(a.get(id),b.get(id)))changes.push({section,id,before:a.get(id)??null,after:b.get(id)??null});
  }
  if(!isDeepStrictEqual(before.settings,after.settings))changes.push({section:'settings',before:before.settings,after:after.settings});
  for(const section of ['people','calendar','monthChecks','openings','grants','uses','rates','passDates','settlementChecks']){
    const a=before.control?.[section]??[],b=after.control[section]??[];
    const key=(r,i)=>r.id??(r.personId?`${r.personId}|${r.kind??r.round??''}`:r.period??r.month??i);
    const am=new Map(a.map((r,i)=>[key(r,i),r])),bm=new Map(b.map((r,i)=>[key(r,i),r]));
    for(const id of new Set([...am.keys(),...bm.keys()]))if(!isDeepStrictEqual(am.get(id),bm.get(id)))changes.push({section,id,before:am.get(id)??null,after:bm.get(id)??null});
  }
  if(changes.length)after.control.audit.push({id:uid('change'),at:new Date().toISOString(),action,source,changes});
  return after;
}
export function closeMonth(data,members,input,currentMonth){
  const {month,periods,source}=input;
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month??'')||month>=currentMonth)throw new Error('只能认定已经结束的月份');
  if(!data.control||!source||!Array.isArray(periods)||!periods.length||new Set(periods).size!==periods.length)throw new Error('需要确认该月完整期次清单 periods 和确认来源 source');
  const meetings=data.control.calendar.filter(m=>m.date.startsWith(month)&&m.status==='已开会'&&!data.settings.excludedPeriods.includes(m.period));
  const expected=meetings.map(m=>m.period).sort((a,b)=>a-b),provided=[...periods].sort((a,b)=>a-b);
  if(!isDeepStrictEqual(expected,provided))throw new Error('确认的期次清单与已登记会议不一致，请补齐整期记录或明确停会');
  for(const m of meetings)for(const person of members.filter(p=>p.status==='参与中'||data.records.some(r=>r.name===p.name&&r.date.startsWith(month)&&r.attendance==='出席'))){
    if((person.joined&&person.joined>m.date)||(person.left&&person.left<m.date))continue;
    const r=data.records.find(r=>r.period===m.period&&r.name===person.name);
    if(!r||!['出席','缺席','不适用'].includes(r.attendance))throw new Error(`${person.name}第${m.period}期出席待确认`);
  }
  const next=structuredClone(data),check={month,periods:provided,source};
  next.control.monthChecks=next.control.monthChecks.filter(c=>c.month!==month).concat(check);
  if(!next.settings.closedMonths.includes(month))next.settings.closedMonths.push(month);
  return next;
}
export function resolveHistoricalAward(data,input){
  if(!input.source||!Number.isInteger(input.period)||!/^\d{4}-\d{2}-\d{2}$/.test(input.date??''))throw new Error('补期次需要 period、date、source');
  const next=structuredClone(data),old=next.records.find(r=>r.awards.some(a=>a.id===input.awardId));
  if(!old)throw new Error('找不到原获奖编号；不能另增一笔冒充补期次');
  if(typeof old.period==='number'){
    if(old.period===input.period&&old.date===input.date)return next;
    throw new Error('该奖项已有期次，请明确更正原记录');
  }
  const award=old.awards.find(a=>a.id===input.awardId);
  let target=next.records.find(r=>r.period===input.period&&r.personId===old.personId);
  if(target?.awards.some(a=>a.name===award.name))throw new Error('目标期次已有同名奖项，请先判断是否同一笔');
  if(target&&target.date!==input.date)throw new Error('目标期次日期不一致');
  if(!target){target={period:input.period,date:input.date,name:old.name,personId:old.personId,attendance:'未记录',roles:[],awards:[],source:'',note:'',sources:{attendance:[],roles:[],awards:[]}};next.records.push(target);}
  if(!next.control.calendar.some(m=>m.period===input.period))next.control.calendar.push({period:input.period,date:input.date,status:'已开会',source:input.source});
  target.awards.push(award);target.sources.awards=[...new Set([...target.sources.awards,...old.sources.awards,input.source])];
  target.source=[...new Set([target.source,old.source,input.source].filter(Boolean))].join('；');
  old.awards=old.awards.filter(a=>a.id!==award.id);
  if(!old.awards.length&&!old.roles.length&&old.attendance==='未记录')next.records=next.records.filter(r=>r!==old);
  return next;
}
