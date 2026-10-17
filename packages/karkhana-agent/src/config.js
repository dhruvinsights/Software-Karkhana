// Where the agent keeps its server address and device token: ~/.karkhana/agent.json,
// readable only by this user. The token is the only secret the agent holds.
import { mkdir, readFile, rm, writeFile, chmod } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const CONFIG_PATH = process.env.KARKHANA_AGENT_CONFIG || join(homedir(), '.karkhana', 'agent.json');
export const DEFAULT_WORK_DIR = join(homedir(), 'karkhana-work');

export async function loadConfig() {
  try {
    return JSON.parse(await readFile(CONFIG_PATH, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw new Error(`cannot read ${CONFIG_PATH}: ${err.message}`);
  }
}

export async function saveConfig(config) {
  await mkdir(dirname(CONFIG_PATH), { recursive: true, mode: 0o700 });
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 });
  await chmod(CONFIG_PATH, 0o600);
}

export async function removeConfig() {
  await rm(CONFIG_PATH, { force: true });
}
