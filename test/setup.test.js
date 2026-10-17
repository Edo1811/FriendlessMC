import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import nbt from 'prismarine-nbt';

// buildServer writes into FRIENDLESS_SERVER_DIR, so point it at a temp folder before importing
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'friendless-'));
process.env.FRIENDLESS_SERVER_DIR = path.join(tmp, 'server');
const { buildServer } = await import('../wizard/setup.js');
const { listWorlds } = await import('../wizard/worlds.js');
const { offlineUuid } = await import('../lib/offlineUuid.js');
const { loadConfig } = await import('../lib/config.js');

function makeWorld(savesDir, folder) {
  const dir = path.join(savesDir, folder);
  fs.mkdirSync(path.join(dir, 'region'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'region', 'r.0.0.mca'), 'region-data');
  fs.writeFileSync(path.join(dir, 'session.lock'), 'lock');
  const level = nbt.comp({
    Data: nbt.comp({
      LevelName: nbt.string('My World'),
      LastPlayed: nbt.long([0, 1_700_000_000]),
      Version: nbt.comp({ Name: nbt.string('1.21.4') }),
      Player: nbt.comp({ Health: nbt.float(17), XpLevel: nbt.int(30) }),
    }),
  });
  fs.writeFileSync(path.join(dir, 'level.dat'), zlib.gzipSync(nbt.writeUncompressed(level)));
  return dir;
}

test('lists singleplayer worlds with name and version', async () => {
  const saves = path.join(tmp, 'saves');
  makeWorld(saves, 'world1');
  const worlds = await listWorlds(saves);
  assert.equal(worlds.length, 1);
  assert.equal(worlds[0].name, 'My World');
  assert.equal(worlds[0].version, '1.21.4');
  assert.equal(worlds[0].lastPlayed, 1_700_000_000);
});

test('buildServer copies the world and writes everything the server needs', async () => {
  const saves = path.join(tmp, 'saves2');
  const worldDir = makeWorld(saves, 'world1');
  const fakeJar = Buffer.from('paper-jar');
  const sha = crypto.createHash('sha256').update(fakeJar).digest('hex');

  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const json = (body) => ({ ok: true, json: async () => body });
    const bin = (buf) => ({ ok: true, arrayBuffer: async () => buf });
    if (url.endsWith('/versions/1.21.4/builds')) {
      return json([{ id: 99, channel: 'STABLE', downloads: { 'server:default': { url: 'https://x/paper.jar', checksums: { sha256: sha } } } }]);
    }
    if (url === 'https://x/paper.jar') return bin(fakeJar);
    if (url.includes('SkinsRestorer')) return bin(Buffer.from('sr-jar'));
    throw new Error(`unexpected fetch ${url}`);
  };

  const log = [];
  try {
    await buildServer({ worldDir, version: '1.21.4', owner: 'Edo', ops: ['Luca', ''], eula: true }, (l) => log.push(l));
  } finally {
    globalThis.fetch = realFetch;
  }

  const server = process.env.FRIENDLESS_SERVER_DIR;
  assert.ok(fs.existsSync(path.join(worldDir, 'level.dat')), 'original world untouched');
  assert.ok(fs.existsSync(path.join(server, 'world', 'region', 'r.0.0.mca')));
  assert.ok(!fs.existsSync(path.join(server, 'world', 'session.lock')));
  assert.equal(fs.readFileSync(path.join(server, 'paper.jar'), 'utf8'), 'paper-jar');
  assert.ok(fs.existsSync(path.join(server, 'plugins', 'SkinsRestorer.jar')));

  const props = fs.readFileSync(path.join(server, 'server.properties'), 'utf8');
  assert.match(props, /online-mode=false/);
  assert.match(props, /enforce-secure-profile=false/);
  assert.match(fs.readFileSync(path.join(server, 'eula.txt'), 'utf8'), /eula=true/);

  const ops = JSON.parse(fs.readFileSync(path.join(server, 'ops.json'), 'utf8'));
  assert.deepEqual(ops.map((o) => [o.name, o.level]), [['Edo', 4], ['Luca', 4], ['Claude', 2]]);
  assert.equal(ops[0].uuid, offlineUuid('Edo'));

  const player = nbt.simplify(
    (await nbt.parse(fs.readFileSync(path.join(server, 'world', 'playerdata', `${offlineUuid('Edo')}.dat`)))).parsed,
  );
  assert.equal(player.XpLevel, 30);

  const claudeMd = fs.readFileSync(path.join(server, '.claude', 'CLAUDE.md'), 'utf8');
  assert.match(claudeMd, /Ops: Edo, Luca\./);
  assert.doesNotMatch(claudeMd, /\{\{/);
  assert.ok(fs.existsSync(path.join(server, '.claude', 'memory.md')));

  const config = loadConfig();
  assert.equal(config.mcVersion, '1.21.4');
  assert.deepEqual(config.ops, ['Edo', 'Luca']);

  await assert.rejects(
    buildServer({ worldDir, version: '1.21.4', owner: 'Edo', ops: [], eula: true }, () => {}),
    /already exists/,
  );
});

test('buildServer refuses without the EULA', async () => {
  await assert.rejects(buildServer({ owner: 'Edo', ops: [], eula: false }, () => {}), /EULA/);
});
