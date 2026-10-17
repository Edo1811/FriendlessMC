import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SERVER_DIR = process.env.FRIENDLESS_SERVER_DIR ?? path.join(ROOT, 'server');
export const CLAUDE_DIR = path.join(SERVER_DIR, '.claude');
export const CONFIG_FILE = path.join(SERVER_DIR, 'friendless.json');
export const MEMORY_FILE = path.join(CLAUDE_DIR, 'memory.md');
export const INSTRUCTIONS_FILE = path.join(CLAUDE_DIR, 'CLAUDE.md');

export const SKIN_URL = 'https://raw.githubusercontent.com/Edo1811/FriendlessMC/main/assets/orange.png';

export const DEFAULTS = {
  botName: 'Claude',
  host: '127.0.0.1',
  port: 25565,
  mcVersion: null,
  ops: [],
  // 'subscription' uses the `claude auth login` session, 'apiKey' uses apiKey below
  auth: 'subscription',
  apiKey: null,
  model: 'claude-opus-5-5',
  effort: 'low',
  javaPath: 'java',
  serverMemory: '4G',
  idleThinkMinutes: 5,
  skinCommands: [
    'sr createcustom claude_orange {url}',
    'skin set claude_orange {bot}',
  ],
};

export function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) {
    throw new Error(`No config at ${CONFIG_FILE}. Run the setup wizard first (npm run wizard).`);
  }
  const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  return { ...DEFAULTS, ...raw };
}

export function saveConfig(config) {
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

export function isOp(config, name) {
  if (!name) return false;
  return config.ops.some((op) => op.toLowerCase() === name.toLowerCase());
}
