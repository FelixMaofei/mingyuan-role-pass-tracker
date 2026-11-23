import {isDeepStrictEqual} from 'node:util';

const fields={attendance:'出席',roles:'角色',awards:'最佳'};
const knownAttendance=['出席','缺席','不适用'];
function attendancePending(data,members,meeting){
  const rows=data.records.filter(r=>r.period===meeting.period);
  const names=new Set(rows.filter(r=>!knownAttendance.includes(r.attendance)).map(r=>r.name));
  for(const m of members.filter(m=>m.status==='参与中'&&(!m.joined||m.joined<=meeting.date)&&(!m.left||m.left>=meeting.date))){
    if(!rows.some(r=>r.name===m.name))names.add(m.name);
  }
  return [...names];
}
// 完成标记由登记材料决定；空数组不自动表示已齐，省略标记沿用已有决定。
export function setMeetingCompletion(data,members,input){
  if(!data.control){if(input.completion)throw new Error('完成状态需要现行工作簿');return;}
  const meeting=data.control.calendar.find(m=>m.period===input.period);
  if(!meeting)throw new Error('找不到本期例会');
  if(Object.hasOwn(input,'completion')){
    if(!input.completion||Array.isArray(input.completion)||typeof input.completion!=='object')throw new Error('completion应为出席、角色、最佳的布尔完成标记');
    for(const [field,done] of Object.entries(input.completion)){
      if(!Object.hasOwn(fields,field)||typeof done!=='boolean')throw new Error('完成标记仅支持 attendance、roles、awards 的 true/false');
      if(field==='attendance'&&done&&attendancePending(data,members,meeting).length)throw new Error('出席尚有待补，不能标记已齐');
      meeting.completion??={};
      meeting.completion[field]={done,source:input.source};
    }
  }
  if(meeting.completion?.attendance?.done&&attendancePending(data,members,meeting).length){
    meeting.completion.attendance={done:false,source:input.source};
  }
}
export function meetingStatus(data,members,period){
  const meeting=data.control?.calendar.find(m=>m.period===period);
  if(!meeting)return null;
  const unknown=attendancePending(data,members,meeting);
  const status=Object.fromEntries(Object.keys(fields).map(field=>[field,meeting.completion?.[field]?.done===true&&(field!=='attendance'||unknown.length===0)?'已齐':'待补']));
  const pending=[];
  for(const [field,label] of Object.entries(fields))if(status[field]==='待补'){
    if(field==='attendance'&&unknown.length)pending.push(...unknown.map(name=>({period,name,field:label})));
    else pending.push({period,field:label,reason:'尚未标记登记完整'});
  }
  return {period,date:meeting.date,...status,complete:pending.length===0,pending};
}
export function registrationSummary(data,members){
  const start=(data.control?.cutoff?.period??data.settings.attendanceStart-1)+1;
  const meetings=(data.control?.calendar??[]).filter(m=>m.period>=start&&m.status==='已开会').sort((a,b)=>a.period-b.period).map(m=>meetingStatus(data,members,m.period));
  return {complete:meetings.length>0&&meetings.every(m=>m.complete),meetings,pending:meetings.flatMap(m=>m.pending)};
}
export function meetingReceipt(before,after,members,beforeModel,afterModel,period){
  const oldRows=before.records.filter(r=>r.period===period),rows=after.records.filter(r=>r.period===period);
  const names=[...new Set([...oldRows,...rows].map(r=>r.name))];
  const changes=[];
  const value=(r,field)=>field==='attendance'?(r?.attendance??'未记录'):field==='awards'?(r?.awards??[]).map(a=>({name:a.name,category:a.category})).sort((a,b)=>a.name.localeCompare(b.name)):(r?.roles??[]);
  for(const name of names)for(const [field,label] of Object.entries(fields)){
    const a=value(oldRows.find(r=>r.name===name),field),b=value(rows.find(r=>r.name===name),field);
    if(!isDeepStrictEqual(a,b))changes.push({name,field:label,before:a,after:b});
  }
  const roleProgress=[],passed=[];
  for(const role of afterModel.roles){
    const old=beforeModel.roles.find(r=>r.name===role.name);
    if(!old)continue;
    if(role.roundNumber!==old.roundNumber||!isDeepStrictEqual(role.roleFlags,old.roleFlags)){
      roleProgress.push({name:role.name,before:`${old.round} ${old.done}/15`,after:`${role.round} ${role.done}/15`});
    }
    for(const event of role.passEvents)if(!old.passEvents.some(e=>e.round===event.round))passed.push({name:role.name,round:event.round,period:event.period});
  }
  const awards=rows.flatMap(r=>r.awards),registration=meetingStatus(after,members,period);
  const recordedAwards={regular:awards.filter(a=>a.category!=='特别奖').length,special:awards.filter(a=>a.category==='特别奖').length};
  return {period,date:registration?.date??rows[0]?.date,
    attendance:{present:rows.filter(r=>r.attendance==='出席').length,absent:rows.filter(r=>r.attendance==='缺席').length},
    awards:registration?.awards==='已齐'?recordedAwards:{regular:null,special:null,recorded:recordedAwards},
    registration,changes,roleProgress,passed};
}
