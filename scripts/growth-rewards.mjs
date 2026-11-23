import {isDeepStrictEqual} from 'node:util';
import {calculate,CATEGORIES,dateString} from './growth-model.mjs';
import {personFor} from './growth-control.mjs';

export const KINDS=['最佳','全勤','通关'];
const amount=n=>Number.isSafeInteger(n)&&n>=0;
const cents=yuan=>{const n=Math.round(yuan*100);if(typeof yuan!=='number'||!Number.isFinite(yuan)||!Number.isSafeInteger(n)||Math.abs(yuan*100-n)>0.000001)throw new Error('金额最多两位小数');return n;};
const monthEnd=month=>new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),0)).toISOString().slice(0,10);
export function validateRewards(data){
  if(!data.control)return;
  const c=data.control,people=new Set(c.people.map(p=>p.id));
  const ids=new Set();
  for(const r of data.records)for(const a of r.awards){if(!a.id||ids.has(a.id))throw new Error('获奖编号缺失或重复');ids.add(a.id);}
  for(const section of ['people','grants','uses']){
    const seen=new Set();
    for(const row of c[section]){if(!row.id||seen.has(row.id))throw new Error(`${section}编号重复`);seen.add(row.id);}
  }
  const openingKeys=new Set();
  for(const o of c.openings){
    const key=`${o.personId}|${o.kind}`;
    if(openingKeys.has(key)||!people.has(o.personId)||!KINDS.includes(o.kind)||!amount(o.earnedCents)||(o.usedCents!==null&&(!amount(o.usedCents)||o.usedCents>o.earnedCents)))throw new Error('历史奖励金额或身份无效');
    if(!o.source||!o.facts||(o.usedCents!==null&&o.earnedCents>0&&!o.settlementSource))throw new Error('历史奖励缺少来源或结算依据');
    openingKeys.add(key);
  }
  for(const g of c.grants)if(!people.has(g.personId)||!KINDS.includes(g.kind)||!amount(g.amountCents)||!g.reference||typeof g.active!=='boolean')throw new Error('新增奖励无效');
  for(const u of c.uses){
    if(!people.has(u.personId)||!Number.isSafeInteger(u.amountCents)||u.amountCents===0||!u.date||!u.source||!u.reference)throw new Error('使用记录缺少金额、日期或依据');
    if(u.amountCents<0){const original=c.uses.find(x=>x.id===u.reverses);if(!original||original.personId!==u.personId||original.amountCents<=0)throw new Error('撤销记录缺少原使用记录');}
  }
  for(const u of c.uses.filter(u=>u.amountCents>0))if(-c.uses.filter(x=>x.reverses===u.id).reduce((s,x)=>s+x.amountCents,0)>u.amountCents)throw new Error('撤销金额超过原使用金额');
  for(const p of c.people){
    const o=c.openings.filter(o=>o.personId===p.id),use=c.uses.filter(u=>u.personId===p.id).reduce((n,u)=>n+u.amountCents,0);
    if(use<0||o.length>3)throw new Error('奖励使用合计无效');
  }
}
function rateFor(c,kind,date){
  const rule=c.rates.filter(r=>r.kind===kind&&r.from<=date).sort((a,b)=>a.from.localeCompare(b.from)).at(-1);
  if(!rule||!amount(rule.cents))throw new Error(`${kind}在${date}缺少奖励标准`);
  return rule.cents;
}
export function syncRewards(data,members){
  if(!data.control)return data;
  const next=structuredClone(data),c=next.control,model=calculate(next,members,{includeInactive:true});
  const facts=[];
  for(const p of c.people){
    const opening=c.openings.filter(o=>o.personId===p.id),best=opening.find(o=>o.kind==='最佳'),role=opening.find(o=>o.kind==='通关');
    for(const r of next.records.filter(r=>r.personId===p.id))for(const a of r.awards.filter(a=>CATEGORIES.includes(a.category))){
      if(best?.facts.awardIds.includes(a.id)||typeof r.period!=='number'||r.period<=c.cutoff.period)continue;
      facts.push({id:a.id,personId:p.id,kind:'最佳',date:r.date,reference:`第${r.period}期 ${a.name}`,source:(r.sources?.awards??[r.source]).join('；')});
    }
    const attendance=model.attendance.find(a=>a.name===p.name);
    for(const month of attendance?.fullMonths??[]){
      if(month<=c.cutoff.month)continue;
      facts.push({id:`attendance:${p.id}:${month}`,personId:p.id,kind:'全勤',date:monthEnd(month),reference:`${month}全勤`,source:next.control.monthChecks.find(m=>m.month===month)?.source||'原全勤台账已确认月份'});
    }
    const progress=model.roles.find(r=>r.name===p.name);
    for(const pass of progress?.passEvents??[]){
      if(!c.passDates.some(x=>x.personId===p.id&&x.round===pass.round))c.passDates.push({personId:p.id,...pass});
      else Object.assign(c.passDates.find(x=>x.personId===p.id&&x.round===pass.round),pass);
    }
    for(let round=(role?.facts.passes??0)+1;round<=(progress?.passes??0);round++){
      const pass=c.passDates.find(x=>x.personId===p.id&&x.round===round);
      if(!pass?.date)continue; // 在余额中明确报缺通关日期，不编造金额。
      facts.push({id:`pass:${p.id}:${round}`,personId:p.id,kind:'通关',date:pass.date,reference:`第${round}轮通关`,source:pass.source||`第${pass.period}期角色记录`});
    }
  }
  const factIds=new Set(facts.map(f=>f.id));
  for(const g of c.grants)g.active=factIds.has(g.id);
  for(const f of facts){
    const prior=c.grants.find(g=>g.id===f.id);
    if(prior){
      if(prior.personId!==f.personId||prior.kind!==f.kind)throw new Error('奖励归属或类型变化，请明确处理原奖励');
      Object.assign(prior,f,{active:true});
      if(prior.amountCents!==rateFor(c,f.kind,f.date))prior.pricingIssue='日期或奖励标准变化，已入账金额保留，差额待确认';else delete prior.pricingIssue;
    }
    else c.grants.push({...f,amountCents:rateFor(c,f.kind,f.date),active:true});
  }
  validateRewards(next);return next;
}
export function rewardSummary(data,members){
  if(!data.control)return [];
  const c=data.control,model=calculate(data,members,{includeInactive:true});
  return c.people.map(p=>{
    const openings=c.openings.filter(o=>o.personId===p.id),issues=[];
    if(openings.length!==3)issues.push('8月以前奖励尚未核对');
    for(const o of openings){
      if(o.usedCents===null)issues.push(`8月${o.kind}${o.earnedCents/100}元的实际抵扣待确认`);
      if(o.kind==='最佳'){
        const ids=data.records.filter(r=>r.personId===p.id).flatMap(r=>r.awards.filter(a=>CATEGORIES.includes(a.category)&&(o.facts.awardIds.includes(a.id)||typeof r.period!=='number'||r.period<=c.cutoff.period)).map(a=>a.id));
        if(!isDeepStrictEqual([...ids].sort(),[...o.facts.awardIds].sort()))issues.push('8月核算范围内的获奖记录发生变化，需核对旧奖励差额');
      }
      if(o.kind==='全勤'){
        const months=model.attendance.find(a=>a.name===p.name)?.fullMonths.filter(m=>m<=c.cutoff.month)??[];
        if(!isDeepStrictEqual([...months].sort(),[...o.facts.months].sort()))issues.push('8月核算范围内的全勤记录发生变化，需核对旧奖励差额');
      }
    }
    const role=model.roles.find(r=>r.name===p.name),basePasses=openings.find(o=>o.kind==='通关')?.facts.passes??0;
    if(role&&role.passes<basePasses)issues.push('累计通关少于8月已核算轮数，需核对旧奖励差额');
    for(let round=basePasses+1;round<=(role?.passes??0);round++)if(!c.passDates.some(x=>x.personId===p.id&&x.round===round&&x.date))issues.push(`第${round}轮通关日期待补，暂不计可用金额`);
    const grants=c.grants.filter(g=>g.personId===p.id&&g.active),uses=c.uses.filter(u=>u.personId===p.id);
    for(const g of grants.filter(g=>g.pricingIssue))issues.push(`${g.reference}：${g.pricingIssue}`);
    const oldEarned=openings.reduce((s,o)=>s+o.earnedCents,0),knownOldUsed=openings.reduce((s,o)=>s+(o.usedCents??0),0),newEarned=grants.reduce((s,g)=>s+g.amountCents,0),used=uses.reduce((s,u)=>s+u.amountCents,0);
    const known=issues.length===0,remaining=known?oldEarned-knownOldUsed+newEarned-used:null;
    if(remaining!==null&&remaining<0)issues.push('已使用金额超过更正后的奖励；保留实际使用，差额待处理');
    // 接管前的使用需核对一次；接管后实际使用统一登记，不每周反复要求确认“没有使用”。
    const check=c.settlementChecks.find(x=>x.personId===p.id),through=c.trackingSince;
    if(!check||check.through<through)issues.push(check?`奖励使用只核对至${check.through}`:'8月之后的奖励使用记录尚未核对');
    return {name:p.name,personId:p.id,status:members.find(m=>m.name===p.name)?.status,openingEarned:oldEarned/100,openingUsed:openings.length===3&&openings.every(o=>o.usedCents!==null)?knownOldUsed/100:null,openingKnownUsed:knownOldUsed/100,newEarned:newEarned/100,newByKind:Object.fromEntries(KINDS.map(k=>[k,grants.filter(g=>g.kind===k).reduce((s,g)=>s+g.amountCents,0)/100])),recordedNewUses:used/100,recordedBalance:remaining===null?null:remaining/100,available:issues.length?null:remaining/100,settlementCheckedThrough:check?.through??null,difference:remaining!==null&&remaining<0?remaining/100:null,issues};
  });
}
export function applySettlement(data,input){
  if(!data.control)throw new Error('奖励记录尚未初始化');
  if(!input.source)throw new Error('需要明确结算确认来源 source');
  const next=structuredClone(data),p=personFor(next,input.name),c=next.control;
  if(input.type==='opening'){
    if(!input.used||!Object.keys(input.used).length)throw new Error('需要确认旧奖励实际使用额 used（单位元）');
    for(const [kind,yuan] of Object.entries(input.used)){
      const o=c.openings.find(o=>o.personId===p.id&&o.kind===kind);
      const n=cents(yuan);
      if(!o||n<0||n>o.earnedCents)throw new Error('历史实际使用金额无效');
      if(o.usedCents!==null&&o.usedCents!==n&&!input.reason)throw new Error('更正已确认的结算需要说明 reason');
      if(o.usedCents!==n){o.usedCents=n;o.settlementSource=input.source;o.confirmedAt=input.confirmedAt||new Date().toISOString().slice(0,10);if(input.reason)o.reason=input.reason;}
    }
  }else if(input.type==='review'){
    const through=dateString(input.through);if(!through)throw new Error('需填写已核对实际使用至哪一天 through');
    const last=c.settlementChecks.find(x=>x.personId===p.id);
    if(last&&through<last.through)throw new Error('不能把已核对日期退回');
    if(last?.through!==through)c.settlementChecks=c.settlementChecks.filter(x=>x.personId!==p.id).concat({personId:p.id,through,source:input.source});
  }else if(input.type==='use'||input.type==='reverse'){
    if(!input.id||!input.reference||!dateString(input.date)||input.amount<=0)throw new Error('实际使用需要固定id、reference、date、正数amount（元）');
    const use={id:input.id,personId:p.id,amountCents:cents(input.amount)*(input.type==='reverse'?-1:1),date:input.date,reference:input.reference,source:input.source,reverses:input.reverses||''};
    const existing=c.uses.find(u=>u.id===use.id);
    if(existing){if(!isDeepStrictEqual(existing,use))throw new Error('同一结算编号内容冲突，不能覆盖');return next;}
    if(c.uses.some(u=>u.personId===use.personId&&u.reference===use.reference&&u.date===use.date&&u.amountCents===use.amountCents&&u.reverses===use.reverses))throw new Error('相同凭据已登记，请使用原编号，不能另起编号重复扣款');
    c.uses.push(use);
  }else throw new Error('结算类型应为 opening / use / reverse / review');
  validateRewards(next);return next;
}
