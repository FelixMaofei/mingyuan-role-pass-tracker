import assert from 'node:assert/strict';
import {test} from 'node:test';
import {initializeControl} from '../scripts/growth-control.mjs';
import {calculate,upsertMeeting,ROLE_NAMES} from '../scripts/growth-model.mjs';
import {meetingStatus,registrationSummary,meetingReceipt} from '../scripts/growth-registration.mjs';

const members=[{name:'甲',status:'参与中',number:'test-1',joined:'2026-01-01',left:'',aliases:['A']}];
const complete={attendance:true,roles:true,awards:true};
const input={period:247,date:'2026-09-23',source:'测试会单及获奖名单',members:[]};
function fixture(){return initializeControl({settings:{bestStart:240,attendanceStart:247,closedMonths:[],excludedPeriods:[]},baselines:[],records:[{period:247,date:input.date,name:'甲',attendance:'出席',roles:[],awards:[],source:'测试出席',note:''}]},members);}
const receipt=(before,after,period=247)=>meetingReceipt(before,after,members,calculate(before,members),calculate(after,members),period);

test('空白获奖不能当成零获奖；明确登记完毕允许零奖项',()=>{
  const d=upsertMeeting(fixture(),members,{...input,completion:{attendance:true,roles:true}});
  assert.equal(meetingStatus(d,members,247).awards,'待补');
  assert.deepEqual(registrationSummary(d,members).pending,[{period:247,field:'最佳',reason:'尚未标记登记完整'}]);
  assert.equal(receipt(fixture(),d).awards.regular,null);assert.equal(receipt(fixture(),d).awards.recorded.regular,0);
  const done=upsertMeeting(d,members,{...input,completion:{awards:true}});
  assert.equal(registrationSummary(done,members).complete,true);
  assert.equal(done.records[0].awards.length,0);
  assert.equal(receipt(d,done).awards.regular,0);
});
test('出席未齐不能标完成；明确改为待确认会取消出席完成状态',()=>{
  const unknown=fixture();unknown.records[0].attendance='待确认';
  assert.throws(()=>upsertMeeting(unknown,members,{...input,completion:complete}),/出席尚有待补/);
  const done=upsertMeeting(fixture(),members,{...input,completion:complete});
  const changed=upsertMeeting(done,members,{...input,members:[{name:'甲',attendance:'待确认'}]});
  const status=meetingStatus(changed,members,247);
  assert.equal(status.attendance,'待补');assert.equal(status.roles,'已齐');assert.equal(status.awards,'已齐');
  assert.deepEqual(status.pending,[{period:247,name:'甲',field:'出席'}]);
});
test('有角色或奖项不自动代表名单完整；完成标记拒绝非布尔值',()=>{
  const d=upsertMeeting(fixture(),members,{...input,members:[{name:'甲',roles:['事务官'],awards:[{name:'最佳主持',category:'主持'}]}]});
  assert.equal(meetingStatus(d,members,247).roles,'待补');assert.equal(meetingStatus(d,members,247).awards,'待补');
  assert.throws(()=>upsertMeeting(d,members,{...input,completion:{awards:'true'}}),/true\/false/);
  assert.throws(()=>upsertMeeting(d,members,{...input,completion:{unknown:true}}),/true\/false/);
});
test('已完成期次更正保留其他完成状态；重复登记无新增且不报金额',()=>{
  const before=upsertMeeting(fixture(),members,{...input,completion:complete});
  const correction={...input,source:'测试更正角色',members:[{name:'A',roles:['时间官']}]};
  const after=upsertMeeting(before,members,correction),repeat=upsertMeeting(after,members,correction);
  assert.deepEqual(repeat,after);assert.equal(meetingStatus(after,members,247).complete,true);
  const result=receipt(before,after);assert.equal(Object.hasOwn(result,'rewards'),false);
  assert.deepEqual(result.changes,[{name:'甲',field:'角色',before:[],after:['时间官']}]);
  assert.deepEqual(result.roleProgress,[{name:'甲',before:'第1轮 0/15',after:'第1轮 1/15'}]);
  assert.deepEqual(receipt(after,repeat).changes,[]);assert.deepEqual(receipt(after,repeat).roleProgress,[]);
});
test('更新旧一期只报告目标期次；角色更正显示前后且覆盖跨轮',()=>{
  let before=fixture();before.baselines=[{name:'甲',rolePeriod:246,round:1,passes:0,roles:ROLE_NAMES.slice(0,14),attendanceThrough:'2026-08',fullMonths:[],attended:0,eligible:0}];
  before=upsertMeeting(before,members,{...input,period:248,date:'2026-09-30',members:[{name:'甲',attendance:'出席',awards:[{name:'最佳点评',category:'点评'}]}]});
  const after=upsertMeeting(before,members,{...input,completion:complete,members:[{name:'甲',roles:['总主持','会议经理']}]});
  const result=receipt(before,after);
  assert.equal(result.period,247);assert.equal(result.awards.regular,0);
  assert.deepEqual(result.passed,[{name:'甲',round:1,period:247}]);
  assert.deepEqual(result.roleProgress,[{name:'甲',before:'第1轮 14/15',after:'第2轮 1/15'}]);
});
test('结算前旧记录不重新列待补；新一期缺完整状态会列出',()=>{
  let d=upsertMeeting(fixture(),members,{...input,completion:complete});
  d.control.calendar.push({period:239,date:'2026-07-29',status:'已开会',source:'已定案归档'});
  assert.equal(registrationSummary(d,members).complete,true);
  d=upsertMeeting(d,members,{...input,period:248,date:'2026-09-30',members:[{name:'甲',attendance:'出席'}]});
  assert.deepEqual(registrationSummary(d,members).pending.map(p=>[p.period,p.field]),[[248,'出席'],[248,'角色'],[248,'最佳']]);
});
