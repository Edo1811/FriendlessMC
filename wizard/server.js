// The one-time setup wizard: a small local web page at http://localhost:4545
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG_FILE, DEFAULTS, saveConfig, loadConfig } from '../lib/config.js';
import { listWorlds, defaultSavesDir, describeWorld } from './worlds.js';
import { versionChoices, buildServer } from './setup.js';
import * as system from './system.js';

const PORT = 4545;
const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

const job = { running: false, done: false, error: null, log: [] };

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  let data = '';
  for await (const chunk of req) data += chunk;
  return data ? JSON.parse(data) : {};
}

function worldPath(savesDir, folder) {
  const dir = path.resolve(savesDir, folder);
  if (path.dirname(dir) !== path.resolve(savesDir)) throw new Error('Bad world folder.');
  return dir;
}

const routes = {
  'GET /api/check': () => ({
    java: system.checkJava(),
    node: system.checkNode(),
    claude: system.checkClaudeCli(),
  }),

  'GET /api/worlds': async (url) => {
    const dir = url.searchParams.get('dir') || defaultSavesDir();
    return { dir, worlds: await listWorlds(dir) };
  },

  'GET /api/versions': async (url) => {
    const dir = url.searchParams.get('dir') || defaultSavesDir();
    const world = await describeWorld(worldPath(dir, url.searchParams.get('world')));
    return { worldVersion: world.version, choices: await versionChoices(world.version) };
  },

  'POST /api/setup': async (_url, body) => {
    if (job.running) throw new Error('Setup is already running.');
    const dir = body.dir || defaultSavesDir();
    Object.assign(job, { running: true, done: false, error: null, log: [] });
    buildServer({ ...body, worldDir: worldPath(dir, body.world) }, (line) => job.log.push(line))
      .then(() => (job.done = true))
      .catch((err) => (job.error = err.message))
      .finally(() => (job.running = false));
    return { started: true };
  },

  'GET /api/progress': () => job,

  'POST /api/login': () => {
    system.openClaudeLogin();
    return { opened: true };
  },

  'GET /api/login/status': () => {
    const config = fs.existsSync(CONFIG_FILE) ? loadConfig() : DEFAULTS;
    return { ...system.claudeAuthStatus(), auth: config.auth };
  },

  'POST /api/apikey': (_url, body) => {
    const config = loadConfig();
    if (body.key) saveConfig({ ...config, auth: 'apiKey', apiKey: body.key.trim() });
    else saveConfig({ ...config, auth: 'subscription', apiKey: null });
    return { saved: true };
  },

  'POST /api/shortcut': () => ({ path: system.createDesktopShortcut() }),
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const route = routes[`${req.method} ${url.pathname}`];
  if (route) {
    try {
      const body = req.method === 'POST' ? await readBody(req) : undefined;
      send(res, 200, await route(url, body));
    } catch (err) {
      send(res, 400, { error: err.message });
    }
    return;
  }
  const file = path.join(PUBLIC, url.pathname === '/' ? 'index.html' : path.normalize(url.pathname));
  if (!file.startsWith(PUBLIC) || !fs.existsSync(file)) {
    res.writeHead(404).end('Not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

server.listen(PORT, '127.0.0.1', () => {
  const url = `http://localhost:${PORT}`;
  console.log(`Setup wizard running at ${url} (close this window when you're done)`);
  system.openBrowser(url);
});
