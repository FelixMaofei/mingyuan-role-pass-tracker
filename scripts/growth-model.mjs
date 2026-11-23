import {uid} from './growth-control.mjs';
import {setMeetingCompletion} from './growth-registration.mjs';
export const ROLE_NAMES=['会议经理','事务官','拍照侠','备稿演讲','备稿点评','即兴点评','总点评','时间官','语法官','哼哈官','颁奖主持','即兴主持','嘉宾主持','真情分享主持','总主持'];
export const CATEGORIES=['会议支持·台前','会议支持·幕后','会议支持·其他','主持','备稿演讲','即兴演讲','点评'];
export const ATTENDANCE=['出席','缺席','待确认','未记录','不适用'];
export const split=value=>String(value??'').split(/[；;\n]/).map(s=>s.trim()).filter(Boolean);
export const join=values=>values.join('；');
export function dateString(value){
  if(!value)return '';
  if(typeof value==='number')return new Date(Date.UTC(1899,11,30)+value*86400000).toISOString().slice(0,10);
  const s=String(value).slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||new Date(s+'T00:00:00Z').toISOString().slice(0,10)!==s)throw new Error('日期应为 YYYY-MM-DD');
  return s;
}
export function aliasesFor(members){
  const map=new Map();
  for(const m of members)for(const a of [m.name,...m.aliases]){
    if(map.has(a)&&map.get(a)!==m.name)throw new Error(`别名重复：${a}`);
    map.set(a,m.name);
  }
  return map;
}
export function validateData(data,members){
  const names=new Set(members.map(m=>m.name)),keys=new Set(),meetingDates=new Map();
  for(const r of data.records){
    if(!names.has(r.name))throw new Error(`会员库没有：${r.name}`);
    if(!(Number.isInteger(r.period)&&r.period>0)&&!/^历史待补-/.test(String(r.period)))throw new Error('期次无效');
    const key=`${r.period}|${r.name}`;
    if(keys.has(key))throw new Error(`重复登记：${key}`);keys.add(key);
    if(typeof r.period==='number'){
      if(!r.date)throw new Error(`第${r.period}期缺日期`);
      dateString(r.date);
      if(meetingDates.has(r.period)&&meetingDates.get(r.period)!==r.date)throw new Error(`第${r.period}期日期冲突`);
      meetingDates.set(r.period,r.date);
    }
    if(!ATTENDANCE.includes(r.attendance))throw new Error(`出席状态无效：${key}`);
    if(new Set(r.roles).size!==r.roles.length||r.roles.some(x=>!ROLE_NAMES.includes(x)))throw new Error(`角色无效或重复：${key}`);
    const awards=new Set();
    for(const a of r.awards){
      if(!a.name||![...CATEGORIES,'特别奖'].includes(a.category)||awards.has(a.name))throw new Error(`奖项无效或重复：${key}`);
      awards.add(a.name);
    }
    if(r.roles.length&&r.attendance==='缺席')throw new Error(`缺席与实际角色冲突：${key}`);
  }
  const baseNames=new Set();
  for(const b of data.baselines){
    if(!names.has(b.name)||baseNames.has(b.name))throw new Error(`历史起点会员无效或重复：${b.name}`);
    baseNames.add(b.name);
    if(!Number.isInteger(b.round)||b.round<1||b.passes!==b.round-1||b.roles.length>=15||new Set(b.roles).size!==b.roles.length||b.roles.some(r=>!ROLE_NAMES.includes(r)))throw new Error(`历史角色起点无效：${b.name}`);
  }
  if(!Number.isInteger(data.settings.bestStart)||!Number.isInteger(data.settings.attendanceStart))throw new Error('统计起始期次无效');
  if(data.control){
    const calendar=new Map();
    for(const m of data.control.calendar){
      if(calendar.has(m.period)||!Number.isInteger(m.period)||!['已开会','停会'].includes(m.status))throw new Error('例会清单冲突');dateString(m.date);calendar.set(m.period,m);
      for(const [field,check] of Object.entries(m.completion??{}))if(!['attendance','roles','awards'].includes(field)||typeof check?.done!=='boolean'||!check.source)throw new Error('例会完成状态缺少有效标记或依据');
    }
    for(const r of data.records.filter(r=>typeof r.period==='number')){const m=calendar.get(r.period);if(!m||m.date!==r.date||m.status!=='已开会')throw new Error(`第${r.period}期与例会清单冲突`);}
    for(const month of data.settings.closedMonths){
      const check=data.control.monthChecks.find(c=>c.month===month),periods=data.control.calendar.filter(m=>m.date.startsWith(month)&&m.status==='已开会'&&!data.settings.excludedPeriods.includes(m.period)).map(m=>m.period).sort((a,b)=>a-b);
      if(!check||!check.source||JSON.stringify(check.periods)!==JSON.stringify(periods))throw new Error(`${month}会议清单变化，请重新确认完整月份`);
    }
  }
}
export function upsertMeeting(data,members,input){
  if(!Number.isInteger(input.period)||input.period<1||!Array.isArray(input.members))throw new Error('需要 period、date、members');
  const date=dateString(input.date);if(!date)throw new Error('缺少例会日期');
  if(!input.source)throw new Error('缺少本次事实来源 source');
  const aliases=aliasesFor(members),result=structuredClone(data),seen=new Set();
  if(result.control){
    const meeting=result.control.calendar.find(m=>m.period===input.period);
    if(meeting&&(meeting.date!==date||meeting.status!=='已开会'))throw new Error('期次日期或停会状态冲突');
    if(!meeting)result.control.calendar.push({period:input.period,date,status:'已开会',source:input.source});
  }
  for(const item of input.members){
    const name=aliases.get(item.name);if(!name)throw new Error(`无法识别会员：${item.name}`);
    if(seen.has(name))throw new Error(`输入中会员重复：${name}`);seen.add(name);
    const member=members.find(m=>m.name===name);
    const existing=result.records.find(r=>r.period===input.period&&r.name===name);
    const baseline=result.baselines.find(b=>b.name===name);
    if(item.roles&&baseline&&input.period<=baseline.rolePeriod)throw new Error('该期角色已包含在历史起点中，请明确修正历史起点；不能重复累计');
    if(!existing&&member.status!=='参与中'&&(!member.left||date>member.left))throw new Error(`${name}已离开或离开日期未确认，不新增离开后的记录`);
    if(!existing&&member.joined&&date<member.joined&&(item.roles?.length||item.awards?.length))throw new Error(`${name}当时尚未入会，不能把入会前嘉宾记录自动转为会员奖励`);
    const record=existing??{period:input.period,date,name,attendance:'待确认',roles:[],awards:[],source:'',note:''};
    if(existing&&existing.date!==date)throw new Error('已有期次日期不同；请先确认期次');
    if(result.control){
      record.personId??=result.control.people.find(p=>p.name===name)?.id;
      record.sources??={attendance:[],roles:[],awards:[]};
      for(const field of ['attendance','roles','awards','note'])if(Object.hasOwn(item,field)){
        let value=structuredClone(item[field]);
        if(field==='roles'&&!item.replaceRoles)value=[...new Set([...record.roles,...value])];
        if(field==='awards'){
          const supplied=value.map(a=>{const old=record.awards.find(x=>x.name===a.name||a.id&&x.id===a.id);if(a.id&&!old)throw new Error('新增奖项不指定id；补历史期次请用 resolve-award');return {...a,id:old?.id??uid('award')};});
          value=item.replaceAwards?supplied:[...record.awards.filter(a=>!supplied.some(x=>x.id===a.id)),...supplied];
        }
        record[field]=value;
        record.sources[field]=[...new Set([...(record.sources[field]??[]),input.source])];
      }
      record.source=[...new Set([record.source,input.source].filter(Boolean))].join('；');
      // 同一来源重复提交不再延长说明。
      record.source=[...new Set(record.source.split('；'))].join('；');
    }else{
      for(const field of ['attendance','roles','awards','note'])if(Object.hasOwn(item,field))record[field]=structuredClone(item[field]);
      record.source=input.source;
    }
    if(!existing)result.records.push(record);
  }
  // 没有被提及的参与会员留为待确认，不从会单缺名推断缺席。
  if(input.period>=result.settings.attendanceStart){
    for(const m of members.filter(m=>m.status==='参与中'&&(!m.joined||m.joined<=date))){
      if(!result.records.some(r=>r.period===input.period&&r.name===m.name))result.records.push({period:input.period,date,name:m.name,attendance:'待确认',roles:[],awards:[],source:input.source,note:'',...(result.control?{personId:result.control.people.find(p=>p.name===m.name)?.id,sources:{attendance:[input.source],roles:[],awards:[]}}:{})});
    }
  }
  result.records.sort((a,b)=>(Number(a.period)||0)-(Number(b.period)||0)||members.findIndex(m=>m.name===a.name)-members.findIndex(m=>m.name===b.name));
  setMeetingCompletion(result,members,input);
  validateData(result,members);return result;
}
export function calculate(data,members,{bestStart=data.settings.bestStart,bestEnd=Infinity,includeInactive=false}={}){
  validateData(data,members);
  const active=includeInactive?members:members.filter(m=>m.status==='参与中');
  const meetings=[...new Map(data.records.filter(r=>typeof r.period==='number').map(r=>[r.period,{period:r.period,date:r.date}])).values()].sort((a,b)=>a.period-b.period);
  const latest=meetings.at(-1);if(!latest)throw new Error('没有例会记录');
  const roles=active.map((member,index)=>{
    const b=data.baselines.find(b=>b.name===member.name)??{rolePeriod:0,round:1,roles:[],passes:0};
    let round=b.round,passes=b.passes,flags=new Set(b.roles),fresh=[],recentPassRounds=[],passEvents=[];
    const rows=data.records.filter(r=>r.name===member.name&&typeof r.period==='number'&&r.period>b.rolePeriod).sort((a,b)=>a.period-b.period);
    for(const r of rows)for(const role of r.roles){
      if(flags.has(role))continue;
      flags.add(role);
      if(r.period===latest.period)fresh.push(role);
      if(flags.size===15){passEvents.push({round,period:r.period,date:r.date,source:(r.sources?.roles??[r.source]).join('；')});if(r.period===latest.period)recentPassRounds.push(round);passes++;round++;flags=new Set();}
    }
    return {name:member.name,index,roundNumber:round,round:`第${round}轮`,passes,done:flags.size,roleFlags:ROLE_NAMES.map(r=>flags.has(r)),fresh,recentPassRounds,passEvents};
  }).sort((a,b)=>b.done-a.done||a.index-b.index);
  const best=active.map(member=>{
    const awards=data.records.filter(r=>r.name===member.name).flatMap(r=>r.awards.map(a=>({...a,period:r.period,date:r.date})));
    const countable=awards.filter(a=>CATEGORIES.includes(a.category));
    const cycle=countable.filter(a=>typeof a.period==='number'&&a.period>=bestStart&&a.period<=bestEnd);
    return {name:member.name,total:countable.length,cycleTotal:cycle.length,categories:CATEGORIES.map(c=>cycle.filter(a=>a.category===c).length),awards,special:awards.filter(a=>a.category==='特别奖')};
  }).sort((a,b)=>b.cycleTotal-a.cycleTotal||active.findIndex(m=>m.name===a.name)-active.findIndex(m=>m.name===b.name));
  const included=meetings.filter(m=>m.period>=data.settings.attendanceStart&&!data.settings.excludedPeriods.includes(m.period));
  const monthKeys=[...new Set(included.map(m=>m.date.slice(0,7)))];
  const attendance=active.map(member=>{
    const b=data.baselines.find(b=>b.name===member.name)??{fullMonths:[],attended:0,eligible:0};
    const fullMonths=[...b.fullMonths],pending=[];let attended=b.attended,eligible=b.eligible,absent=0;
    // 已承接的月份不再从逐期明细重复累计；各人的承接时间可以不同。
    const months=monthKeys.filter(month=>!b.attendanceThrough||month>b.attendanceThrough).map(month=>{
      const monthMeetings=included.filter(m=>m.date.startsWith(month));
      let present=0,missing=0,unknown=0,applicable=0;
      for(const meeting of monthMeetings){
        const r=data.records.find(r=>r.name===member.name&&r.period===meeting.period);
        // 显式历史记录优先；入会日期只帮助确定新记录是否适用，不覆盖已确认历史。
        if(r?.attendance==='不适用'||(!r&&member.joined&&member.joined>meeting.date))continue;
        applicable++;
        if(r?.attendance==='出席')present++;
        else if(r?.attendance==='缺席')missing++;
        else{unknown++;pending.push(meeting.period);}
      }
      const closed=data.settings.closedMonths.includes(month);
      const full=closed&&present===monthMeetings.length&&unknown===0;
      if(full&&!fullMonths.includes(month))fullMonths.push(month);
      attended+=present;eligible+=applicable;absent+=missing;
      return {month,present,absent:missing,pending:unknown,eligible:applicable,meetingCount:monthMeetings.length,full,status:closed?(unknown?'待确认':full?'全勤':'非全勤'):'进行中'};
    });
    return {name:member.name,fullMonths,fullCount:fullMonths.length,reward:fullMonths.length*5,attended,eligible,absent,pending,months};
  });
  return {latest,memberCount:active.length,roles,best,attendance,meetings,bestStart,bestEnd:Number.isFinite(bestEnd)?bestEnd:latest.period,pending:attendance.flatMap(a=>a.pending.map(period=>({period,name:a.name,field:'出席'})))};
}
export function progressModel(model){
  const members=model.roles;
  const highlights=[...members.filter(m=>m.recentPassRounds.length).map(m=>({...m,type:'pass'})),...members.filter(m=>!m.recentPassRounds.length&&m.fresh.length).map(m=>({...m,type:'new',before:m.done-m.fresh.length}))];
  return {roles:ROLE_NAMES,meeting:{period:`第${model.latest.period}期`,periodNumber:model.latest.period,date:model.latest.date},members,highlights,totalPasses:members.reduce((s,m)=>s+m.passes,0)};
}
