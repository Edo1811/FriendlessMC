// What the "Start Claude server" shortcut runs: the Paper server and the bot together.
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import readline from 'node:readline';
import { loadConfig, SERVER_DIR, ROOT, SKIN_URL } from './lib/config.js';
import { applyPendingEdits } from './bridge/fileEdits.js';

const config = loadConfig();
const log = (msg) => console.log(`[start] ${msg}`);

if (!fs.existsSync(path.join(SERVER_DIR, 'paper.jar'))) {
  log('No server found. Run the setup wizard first: npm run wizard');
  process.exit(1);
}

// queued op-mode file edits can only be applied while the server is stopped
try {
  await applyPendingEdits(config, log);
} catch (err) {
  log(`Couldn't apply queued file edits: ${err.message}`);
}

log('Starting the Minecraft server...');
const server = spawn(config.javaPath, [`-Xmx${config.serverMemory}`, '-jar', 'paper.jar', '--nogui'], {
  cwd: SERVER_DIR,
  stdio: ['pipe', 'pipe', 'inherit'],
});

let bot = null;
let stopping = false;

const sendToServer = (line) => server.stdin.write(`${line}\n`);

function startBot() {
  log('Server is ready. Starting Claude...');
  bot = spawn(process.execPath, [path.join(ROOT, 'bot', 'index.js')], { cwd: ROOT, stdio: 'inherit' });
  bot.on('exit', (code) => {
    if (stopping) return;
    log(`Claude's bot stopped (code ${code}). Restarting it in 10s...`);
    setTimeout(startBot, 10_000);
  });
}

function applySkin() {
  for (const cmd of config.skinCommands) {
    sendToServer(cmd.replace('{url}', SKIN_URL).replace('{bot}', config.botName));
  }
}

let ready = false;
let skinApplied = false;
readline.createInterface({ input: server.stdout }).on('line', (line) => {
  console.log(line);
  if (!ready && /Done \([\d.,]+s\)!/.test(line)) {
    ready = true;
    startBot();
  }
  // the skin is applied once per run, after Claude has joined
  if (!skinApplied && new RegExp(`\\b${config.botName} joined the game`).test(line)) {
    skinApplied = true;
    applySkin();
  }
});

// what you type in this window goes to the server console (e.g. "stop", "op Name")
readline.createInterface({ input: process.stdin }).on('line', (line) => sendToServer(line));

server.on('exit', (code) => {
  stopping = true;
  bot?.kill();
  log(`Server stopped (code ${code}).`);
  process.exit(code ?? 0);
});

process.on('SIGINT', () => {
  if (stopping) return;
  log('Stopping...');
  stopping = true;
  bot?.kill();
  sendToServer('stop');
});
