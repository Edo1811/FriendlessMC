import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import nbt from 'prismarine-nbt';

export function defaultSavesDir() {
  const base = process.env.APPDATA ?? os.homedir();
  return path.join(base, '.minecraft', 'saves');
}

function toNumber(long) {
  if (typeof long === 'bigint') return Number(long);
  if (Array.isArray(long)) return long[0] * 2 ** 32 + (long[1] >>> 0);
  return Number(long ?? 0);
}

export async function readLevelDat(worldDir) {
  const { parsed } = await nbt.parse(fs.readFileSync(path.join(worldDir, 'level.dat')));
  return parsed;
}

export async function describeWorld(worldDir) {
  const data = nbt.simplify(await readLevelDat(worldDir)).Data;
  return {
    folder: path.basename(worldDir),
    name: data.LevelName ?? path.basename(worldDir),
    version: data.Version?.Name ?? null,
    lastPlayed: toNumber(data.LastPlayed),
  };
}

export async function listWorlds(savesDir = defaultSavesDir()) {
  if (!fs.existsSync(savesDir)) return [];
  const worlds = [];
  for (const entry of fs.readdirSync(savesDir, { withFileTypes: true })) {
    const dir = path.join(savesDir, entry.name);
    if (!entry.isDirectory() || !fs.existsSync(path.join(dir, 'level.dat'))) continue;
    try {
      worlds.push(await describeWorld(dir));
    } catch {
      worlds.push({ folder: entry.name, name: entry.name, version: null, lastPlayed: 0, unreadable: true });
    }
  }
  return worlds.sort((a, b) => b.lastPlayed - a.lastPlayed);
}
