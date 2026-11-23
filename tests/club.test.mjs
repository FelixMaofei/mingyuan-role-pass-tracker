import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

const entry = fileURLToPath(new URL('../scripts/club.mjs', import.meta.url));
function invoke(args, cli = '') {
  return spawnSync(process.execPath, [entry, ...args], {
    env: {...process.env, CLUB_GROWTH_CLI: cli, CLUB_GROWTH_NODE: process.execPath},
    encoding: 'utf8',
  });
}
test('没有配置时停在本地', () => {
  const result = invoke(['summary']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /尚未指定/);
});
test('会单预览和保存分别交给经办终端，保留实际退出状态', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tm-role-test-'));
  try {
    const mock = join(dir, 'mock-cli.mjs'), input = join(dir, '演练 输入.json');
    await writeFile(mock, "console.log(JSON.stringify(process.argv.slice(2))); if(process.argv[2]==='settlement') process.exitCode=7;");
    await writeFile(input, '{}');
    for (const tail of [['--dry-run'], []]) {
      const result = invoke(['update', input, ...tail], mock);
      assert.equal(result.status, 0);
      assert.deepEqual(JSON.parse(result.stdout), ['update', input, ...tail]);
    }
    assert.equal(invoke(['settlement', input], mock).status, 7);
    assert.equal(invoke(['query', '--ledger'], mock).status, 1);
    assert.equal(invoke(['summary'], entry).status, 1);
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
});
