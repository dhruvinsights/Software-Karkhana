import { hostname, platform, release } from 'node:os';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { pair } from './api.js';
import { CONFIG_PATH, DEFAULT_WORK_DIR, loadConfig, removeConfig, saveConfig } from './config.js';
import { HARNESSES } from './harness.js';
import { has } from './proc.js';
import { work } from './work.js';

const HELP = `karkhana-agent: build Software Karkhana stories on this machine

  karkhana-agent login --server <url> --code <XXXX-XXXX> [--name <name>] [--harness bob|claude]
      Connects this machine. Get the code from Software Karkhana: Developer → Connect a machine.

  karkhana-agent work [--dir <path>] [--harness bob|claude] [--once]
      Waits for builds you start in Software Karkhana. Each story is coded in its own
      git worktree under <path> (default ${DEFAULT_WORK_DIR}), tested, committed locally,
      and sent back for review and a pull request.

  karkhana-agent status     Shows the connection.
  karkhana-agent logout     Forgets this machine's token (revoke it in the app too).
`;

async function login(args) {
  const { values } = parseArgs({
    args,
    options: { server: { type: 'string' }, code: { type: 'string' }, name: { type: 'string' }, harness: { type: 'string', default: 'bob' } },
  });
  if (!values.server || !values.code) throw new Error('login needs --server and --code');
  if (!HARNESSES[values.harness]) throw new Error(`--harness must be one of: ${Object.keys(HARNESSES).join(', ')}`);
  if (!(await has(values.harness))) throw new Error(`${values.harness} is not installed or not on PATH`);
  const server = values.server.replace(/\/+$/, '');
  const out = await pair(server, {
    code: values.code.trim().toUpperCase(),
    name: values.name || hostname(),
    platform: `${platform()} ${release()}`,
    harness: values.harness,
  });
  await saveConfig({ server, token: out.token, deviceId: out.deviceId, name: out.name, harness: values.harness });
  console.log(`Connected "${out.name}" to ${server}. Next: karkhana-agent work`);
  return 0;
}

async function startWork(args) {
  const { values } = parseArgs({
    args,
    options: { dir: { type: 'string' }, harness: { type: 'string' }, once: { type: 'boolean', default: false } },
  });
  const config = await loadConfig();
  if (!config) throw new Error('not connected; run `karkhana-agent login` first');
  const harness = values.harness || config.harness || 'bob';
  if (!(await has('git'))) throw new Error('git is not installed');
  if (!(await has(harness))) throw new Error(`${harness} is not installed or not on PATH`);
  return work(config, { workDir: resolve(values.dir || DEFAULT_WORK_DIR), harness, once: values.once });
}

async function status() {
  const config = await loadConfig();
  console.log(config ? `Connected as "${config.name}" to ${config.server} (harness ${config.harness}). Config: ${CONFIG_PATH}` : 'Not connected.');
  return config ? 0 : 1;
}

export async function main(argv) {
  const [command, ...rest] = argv;
  switch (command) {
    case 'login':
      return login(rest);
    case 'work':
      return startWork(rest);
    case 'status':
      return status();
    case 'logout':
      await removeConfig();
      console.log('Forgot this machine. Revoke it in Software Karkhana as well.');
      return 0;
    default:
      console.log(HELP);
      return command && command !== 'help' && command !== '--help' ? 1 : 0;
  }
}
