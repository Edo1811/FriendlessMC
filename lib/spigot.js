// Paper only sends players and mobs to clients within these ranges (spigot.yml). The bot can't
// see past them, so they're raised. Paper also caps them at the view distance (10 chunks = 160).
export const TRACKING_RANGES = { players: 160, animals: 128, monsters: 128, misc: 96 };

// Raises the values in every `entity-tracking-range:` block; never lowers one.
export function raiseTrackingRanges(yaml, ranges = TRACKING_RANGES) {
  const lines = yaml.split('\n');
  let blockIndent = null;
  let changed = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const indent = line.match(/^ */)[0].length;
    if (/^\s*entity-tracking-range:\s*$/.test(line)) {
      blockIndent = indent;
      continue;
    }
    if (blockIndent === null) continue;
    if (line.trim() && indent <= blockIndent) {
      blockIndent = null;
      continue;
    }
    const m = line.match(/^(\s*)([a-z-]+):\s*(\d+)\s*$/);
    if (m && ranges[m[2]] !== undefined && Number(m[3]) < ranges[m[2]]) {
      lines[i] = `${m[1]}${m[2]}: ${ranges[m[2]]}`;
      changed = true;
    }
  }
  return { yaml: lines.join('\n'), changed };
}
