import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {initializeControl, closeMonth} from './growth-control.mjs';
import {calculate, dateString, upsertMeeting} from './growth-model.mjs';
import {registrationSummary} from './growth-registration.mjs';
import {applySettlement, KINDS, rewardSummary, syncRewards} from './growth-rewards.mjs';

export function rehearse(scenario) {
  const {startDate, members, meetings, closeMonths = [], settlements = []} = scenario;
  if (!Array.isArray(members) || !members.length || !Array.isArray(meetings) || !meetings.length) {
    throw new Error('需要至少一名演练成员和一份例会登记。');
  }
  if (!dateString(startDate) || meetings.some(meeting => !meeting.date || meeting.date < startDate)) {
    throw new Error('startDate 必须是不晚于第一场演练的日期。');
  }
  const firstPeriod = Math.min(...meetings.map(meeting => meeting.period));
  const settings = {bestStart: firstPeriod, attendanceStart: firstPeriod, closedMonths: [], excludedPeriods: []};
  // 演练以零余额启动；俱乐部正式账上的历史结转由正式系统维护。
  let data = initializeControl({settings, records: [], baselines: []}, members);
  const priorMonth = new Date(startDate.slice(0, 7) + '-01T00:00:00Z');
  priorMonth.setUTCDate(0);
  const control = data.control;
  control.cutoff = {period: firstPeriod - 1, month: priorMonth.toISOString().slice(0, 7)};
  control.trackingSince = startDate;
  control.rates = KINDS.map(kind => ({kind, from: startDate, cents: kind === '通关' ? 6600 : 500}));
  for (const person of control.people) {
    for (const kind of KINDS) {
      const facts = kind === '最佳' ? {awardIds: []} : kind === '全勤' ? {months: []} : {passes: 0};
      control.openings.push({personId: person.id, kind, earnedCents: 0, usedCents: 0,
        facts, source: '演练从零起算', settlementSource: '演练没有期初抵扣'});
    }
    control.settlementChecks.push({personId: person.id, through: startDate, source: '演练期初已核对'});
  }
  for (const meeting of meetings) data = upsertMeeting(data, members, meeting);
  const currentMonth = new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit'}).format(new Date());
  for (const confirmation of closeMonths) data = closeMonth(data, members, confirmation, currentMonth);
  data = syncRewards(data, members);
  for (const settlement of settlements) data = applySettlement(data, settlement);
  const statistics = calculate(data, members);
  return {
    mode: '离线演练', savedToClub: false,
    registration: registrationSummary(data, members),
    roles: statistics.roles.map(({name, round, done, passes}) => ({name, round, done, passes})),
    best: statistics.best.map(({name, cycleTotal, special}) => ({name, cycleTotal, special})),
    attendance: statistics.attendance.map(({name, fullMonths, pending}) => ({name, fullMonths, pending})),
    rewards: rewardSummary(data, members).map(({name, newByKind, recordedNewUses, available, issues}) =>
      ({name, newByKind, recordedNewUses, available, issues})),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const input = process.argv[2] ?? new URL('../examples/rehearsal.json', import.meta.url);
    const scenario = JSON.parse(await readFile(input, 'utf8'));
    console.log(JSON.stringify(rehearse(scenario), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
