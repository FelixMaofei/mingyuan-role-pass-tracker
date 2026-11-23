import {spawnSync} from 'node:child_process';
import {realpathSync, statSync} from 'node:fs';
import {isAbsolute, resolve} from 'node:path';

function run() {
  const [command, ...args] = process.argv.slice(2);
  const commands = new Set(['summary', 'query', 'rewards', 'update', 'close-month', 'settlement']);
  if (!commands.has(command)) throw new Error('可用命令：summary / query / rewards / update / close-month / settlement。');
  const fileCommand = ['update', 'close-month', 'settlement'].includes(command);
  if (fileCommand) {
    if (args.length < 1 || args.length > 2 || args[0].startsWith('-') || (args[1] && args[1] !== '--dry-run')) {
      throw new Error('请提供本地业务 JSON 路径；可追加 --dry-run 预览。');
    }
    args[0] = resolve(args[0]);
    if (!statSync(args[0]).isFile()) throw new Error('登记输入应是本地 JSON 文件。');
  } else if (args.length > (command === 'summary' ? 0 : 1) || args.some(arg => arg.startsWith('-'))) {
    throw new Error('summary 无参数；query / rewards 可跟一个会员显示名。');
  }
  const cli = process.env.CLUB_GROWTH_CLI;
  if (!cli || !isAbsolute(cli)) throw new Error('本机尚未指定获授权的正式入口。请将 CLUB_GROWTH_CLI 设为俱乐部提供的 growth-ledger.mjs 绝对路径。');
  if (!statSync(cli).isFile() || realpathSync(cli) === realpathSync(process.argv[1])) throw new Error('正式入口必须是独立的内部脚本。');
  const node = process.env.CLUB_GROWTH_NODE || process.execPath;
  if (!isAbsolute(node)) throw new Error('CLUB_GROWTH_NODE 应为已获授权环境的 Node 绝对路径。');
  const result = spawnSync(node, [cli, command, ...args], {stdio: 'inherit', shell: false});
  if (result.error) throw result.error;
  if (result.signal) throw new Error('正式入口中断，请先向正式系统核对记录。');
  return result.status ?? 1;
}

try {
  process.exitCode = run();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
