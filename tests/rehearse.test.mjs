import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {ROLE_NAMES} from '../scripts/growth-model.mjs';
import {rehearse} from '../scripts/rehearse.mjs';

const fixture = JSON.parse(await readFile(new URL('../examples/rehearsal.json', import.meta.url), 'utf8'));
test('核准的两期会单、整月全勤、奖励抵扣和重复提交', () => {
  const first = rehearse(fixture);
  assert.equal(first.registration.complete, true);
  assert.equal(first.rewards[0].available, 8);
  assert.deepEqual(first.rewards[0].newByKind, {'最佳': 5, '全勤': 5, '通关': 0});
  assert.equal(first.rewards[1].available, 0);
  assert.equal(first.savedToClub, false);
  const replay = structuredClone(fixture);
  replay.meetings.push(replay.meetings[0]);
  replay.settlements.push(replay.settlements[0]);
  assert.deepEqual(rehearse(replay), first);
});
test('15 项完成进入新一轮，角色重复不叠加', () => {
  const input = structuredClone(fixture);
  input.meetings[0].members[0].roles = ROLE_NAMES.slice(0, 14);
  input.meetings[1].members[0].roles = [ROLE_NAMES[0], ROLE_NAMES[14], ROLE_NAMES[1]];
  const result = rehearse(input);
  assert.equal(result.roles[0].passes, 1);
  assert.equal(result.roles[0].done, 1);
  assert.equal(result.rewards[0].newByKind['通关'], 66);
});
test('月末完整场次必须匹配，缺少获奖名单应保留待补', () => {
  const input = structuredClone(fixture);
  input.closeMonths[0].periods.pop();
  assert.throws(() => rehearse(input), /不一致/);
  input.closeMonths = [];
  delete input.meetings[1].completion.awards;
  const result = rehearse(input);
  assert.equal(result.registration.complete, false);
  assert.equal(result.rewards[0].newByKind['全勤'], 0);
});
