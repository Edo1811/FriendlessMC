import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import nbt from 'prismarine-nbt';
import mineflayer from 'mineflayer';
import { ROOT, SERVER_DIR, CLAUDE_DIR, DEFAULTS, saveConfig } from '../lib/config.js';
import { offlineUuid } from '../lib/offlineUuid.js';
import { buildVersionChoices } from '../lib/versions.js';
import { readLevelDat } from './worlds.js';

const USER_AGENT = 'FriendlessMC/1.0 (https://github.com/Edo1811/FriendlessMC)';
const PAPER_API = 'https://fill.papermc.io/v3/projects/paper';
const SKINSRESTORER_URL = 'https://github.com/SkinsRestorer/SkinsRestorer/releases/latest/download/SkinsRestorer.jar';

async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res.json();
}

async function download(url, dest, sha256) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, redirect: 'follow' });
  if (!res.ok) throw new Error(`Download failed (${res.status}): ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (sha256) {
    const actual = crypto.createHash('sha256').update(buf).digest('hex');
    if (actual !== sha256) throw new Error(`Checksum mismatch for ${path.basename(dest)}`);
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
  return buf.length;
}

export async function paperVersions() {
  const project = await getJson(PAPER_API);
  return Object.values(project.versions).flat();
}

export async function versionChoices(worldVersion) {
  return buildVersionChoices(await paperVersions(), mineflayer.testedVersions, worldVersion);
}

async function latestPaperBuild(version) {
  const builds = await getJson(`${PAPER_API}/versions/${version}/builds`);
  const build = builds.find((b) => b.channel === 'STABLE') ?? builds[0];
  if (!build) throw new Error(`Paper has no builds for ${version}.`);
  return { id: build.id, channel: build.channel, ...build.downloads['server:default'] };
}

function copyWorld(src, dest) {
  return fs.promises.cp(src, dest, {
    recursive: true,
    filter: (p) => path.basename(p) !== 'session.lock',
  });
}

// Singleplayer keeps the host's player in level.dat. On the server the owner joins with an
// offline UUID, so their inventory and position move into playerdata/<offline uuid>.dat.
async function transferSingleplayerPlayer(worldDir, ownerName) {
  const level = await readLevelDat(worldDir);
  const player = level.value.Data?.value?.Player;
  if (!player) return false;
  const file = nbt.writeUncompressed({ type: 'compound', name: '', value: player.value });
  const dir = path.join(worldDir, 'playerdata');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${offlineUuid(ownerName)}.dat`), zlib.gzipSync(file));
  return true;
}

function writeServerProperties(port) {
  const props = {
    'online-mode': 'false',
    // offline-mode bots can't sign chat messages
    'enforce-secure-profile': 'false',
    'level-name': 'world',
    'server-port': String(port),
    motd: "Claude's server",
    'spawn-protection': '0',
  };
  fs.writeFileSync(
    path.join(SERVER_DIR, 'server.properties'),
    Object.entries(props).map(([k, v]) => `${k}=${v}`).join('\n') + '\n',
  );
}

function writeOps(ops, botName) {
  const list = ops.map((name) => ({ uuid: offlineUuid(name), name, level: 4, bypassesPlayerLimit: false }));
  // level 2 is enough for the op-mode commands; the bridge decides when Claude may use them
  list.push({ uuid: offlineUuid(botName), name: botName, level: 2, bypassesPlayerLimit: false });
  fs.writeFileSync(path.join(SERVER_DIR, 'ops.json'), JSON.stringify(list, null, 2));
}

function writeClaudeFolder(owner, ops) {
  fs.mkdirSync(CLAUDE_DIR, { recursive: true });
  const template = fs.readFileSync(path.join(ROOT, 'templates', 'CLAUDE.md'), 'utf8');
  fs.writeFileSync(
    path.join(CLAUDE_DIR, 'CLAUDE.md'),
    template.replaceAll('{{OWNER}}', owner).replaceAll('{{OPS}}', ops.join(', ')),
  );
  fs.copyFileSync(path.join(ROOT, 'templates', 'settings.json'), path.join(CLAUDE_DIR, 'settings.json'));
  const memory = path.join(CLAUDE_DIR, 'memory.md');
  if (!fs.existsSync(memory)) fs.copyFileSync(path.join(ROOT, 'templates', 'memory.md'), memory);
}

// options: { worldDir, version, owner, ops[], eula }
export async function buildServer(options, log) {
  const { worldDir, version, owner, eula } = options;
  const ops = [...new Set([owner, ...options.ops].map((o) => o.trim()).filter(Boolean))];

  if (!eula) throw new Error("The Minecraft EULA has to be accepted before the server can run.");
  if (!/^[A-Za-z0-9_]{3,16}$/.test(owner)) throw new Error('Your Minecraft name looks wrong (3-16 letters, digits or _).');
  for (const op of ops) {
    if (!/^[A-Za-z0-9_]{3,16}$/.test(op)) throw new Error(`"${op}" isn't a valid Minecraft name.`);
  }
  if (fs.existsSync(path.join(SERVER_DIR, 'world'))) {
    throw new Error('A server already exists. Delete the "server" folder to set up a new one.');
  }

  fs.mkdirSync(SERVER_DIR, { recursive: true });

  log('Copying the world (the original stays untouched)...');
  const dest = path.join(SERVER_DIR, 'world');
  await copyWorld(worldDir, dest);
  if (await transferSingleplayerPlayer(dest, owner)) log(`Moved your singleplayer inventory and position to ${owner}.`);

  log(`Downloading Paper ${version}...`);
  const build = await latestPaperBuild(version);
  await download(build.url, path.join(SERVER_DIR, 'paper.jar'), build.checksums?.sha256);
  log(`Paper ${version} build ${build.id} (${build.channel}) downloaded.`);

  log('Downloading SkinsRestorer...');
  await download(SKINSRESTORER_URL, path.join(SERVER_DIR, 'plugins', 'SkinsRestorer.jar'));

  log('Writing server settings (offline mode, ops)...');
  writeServerProperties(DEFAULTS.port);
  writeOps(ops, DEFAULTS.botName);
  fs.writeFileSync(path.join(SERVER_DIR, 'eula.txt'), `# Accepted in the setup wizard on ${new Date().toISOString()}\neula=true\n`);

  log("Creating Claude's .claude folder (instructions, memory, permissions)...");
  writeClaudeFolder(owner, ops);

  saveConfig({ ...DEFAULTS, mcVersion: version, ops, owner });
  log('Server is ready.');
}
