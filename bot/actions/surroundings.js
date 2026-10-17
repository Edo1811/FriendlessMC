import vec3 from 'vec3';
import { fmtPos, compass } from './util.js';

const DIRECTIONS = [
  ['N', 0, -1], ['NE', 1, -1], ['E', 1, 0], ['SE', 1, 1],
  ['S', 0, 1], ['SW', -1, 1], ['W', -1, 0], ['NW', -1, -1],
];

const SEE_THROUGH = new Set(['air', 'cave_air', 'void_air', 'short_grass', 'tall_grass', 'fern', 'large_fern',
  'snow', 'dead_bush', 'vine', 'glow_lichen', 'light']);

const NOTABLE = [
  'chest', 'trapped_chest', 'barrel', 'ender_chest', 'shulker_box', '_bed', 'furnace', 'smoker',
  'crafting_table', 'anvil', 'enchanting_table', 'brewing_stand', 'nether_portal', 'end_portal_frame',
  'spawner', 'bell', 'lectern', 'beacon', 'campfire', 'composter', 'hopper', 'jukebox', 'note_block',
  '_sign', '_banner', 'wheat', 'carrots', 'potatoes', 'beetroots', 'sugar_cane', 'pumpkin', 'melon',
];

// entries starting with "_" match any block ending in them (oak_sign, red_bed...)
function isNotable(name) {
  return NOTABLE.some((n) => (n.startsWith('_') ? name.endsWith(n) : name === n || name.endsWith(`_${n}`)));
}

// Top solid block of a column, searching around the given height.
function surfaceAt(bot, x, z, aroundY) {
  for (let y = aroundY + 24; y >= aroundY - 24; y--) {
    const b = bot.blockAt(vec3(x, y, z));
    if (!b) return null; // not loaded
    if (!SEE_THROUGH.has(b.name)) return { name: b.name, y };
  }
  return { name: 'deep drop', y: aroundY - 25 };
}

function top(counts, n) {
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, n).map(([name]) => name.replace(/_/g, ' '));
}

function describeDirection(bot, origin, dx, dz, range) {
  const counts = {};
  const heights = [];
  let water = false;
  let lava = false;
  let trees = 0;
  const len = Math.hypot(dx, dz);
  for (let dist = 4; dist <= range; dist += 4) {
    for (const side of [-0.35, 0, 0.35]) {
      const x = Math.floor(origin.x + ((dx - dz * side) / len) * dist);
      const z = Math.floor(origin.z + ((dz + dx * side) / len) * dist);
      const s = surfaceAt(bot, x, z, Math.floor(origin.y));
      if (!s) continue;
      counts[s.name] = (counts[s.name] ?? 0) + 1;
      heights.push(s.y - Math.floor(origin.y) + 1);
      if (s.name === 'water') water = true;
      if (s.name === 'lava') lava = true;
      if (s.name.endsWith('_log') || s.name.endsWith('_leaves')) trees++;
    }
  }
  if (!heights.length) return 'not loaded';
  const avg = heights.reduce((a, b) => a + b, 0) / heights.length;
  const far = heights.slice(-3).reduce((a, b) => a + b, 0) / Math.min(3, heights.length);
  const parts = [top(counts, 3).join(', ')];
  if (trees >= 3) parts.push('trees');
  if (water) parts.push('water');
  if (lava) parts.push('LAVA');
  if (far > 6) parts.push(`rises ~${Math.round(far)} blocks`);
  else if (far < -6) parts.push(`drops ~${Math.round(-far)} blocks`);
  else if (Math.abs(avg) <= 2) parts.push('flat');
  return parts.join('; ');
}

function signText(block) {
  try {
    const text = block.getSignText?.();
    const lines = (Array.isArray(text) ? text : [text]).filter(Boolean).join(' / ').replace(/\s+/g, ' ').trim();
    return lines || null;
  } catch {
    return null;
  }
}

// A cheap text picture of the area: biome, sky, each direction, notable blocks and signs.
export function lookAround(bot, { range = 32 } = {}) {
  const pos = bot.entity.position;
  const feet = bot.blockAt(pos.floored());
  const lines = [];

  let roof = null;
  for (let y = 2; y < 64; y++) {
    const b = bot.blockAt(pos.floored().offset(0, y, 0));
    if (!b) break;
    if (!SEE_THROUGH.has(b.name) && !b.name.endsWith('_leaves')) {
      roof = { name: b.name, y };
      break;
    }
  }
  const biome = feet?.biome?.name ? feet.biome.name.replace(/_/g, ' ') : 'unknown';
  const skyLight = feet?.skyLight;
  const where = roof
    ? skyLight !== undefined && skyLight < 4 ? `underground or indoors (${roof.name} ${roof.y} blocks above)` : `under ${roof.name.replace(/_/g, ' ')} ${roof.y} blocks above`
    : 'open sky';
  lines.push(`At ${fmtPos(pos)} in ${bot.game.dimension}, biome: ${biome}, ${where}.`);

  lines.push(`Around you (up to ${range} blocks):`);
  for (const [name, dx, dz] of DIRECTIONS) lines.push(`  ${name}: ${describeDirection(bot, pos, dx, dz, range)}`);

  const notableIds = bot.registry.blocksArray.filter((b) => isNotable(b.name)).map((b) => b.id);
  const found = bot.findBlocks({ matching: notableIds, maxDistance: range, count: 60 });
  const groups = {};
  const signs = [];
  for (const p of found) {
    const b = bot.blockAt(p);
    if (!b) continue;
    if (b.name.endsWith('_sign')) {
      const text = signText(b);
      if (text && signs.length < 6) signs.push(`"${text}" (${p.distanceTo(pos).toFixed(0)}m ${compass(pos, p)})`);
    }
    const key = b.name.replace(/^(white|orange|magenta|light_blue|yellow|lime|pink|gray|light_gray|cyan|purple|blue|brown|green|red|black)_/, '');
    const d = p.distanceTo(pos);
    if (!groups[key] || d < groups[key].d) groups[key] = { d, p, count: (groups[key]?.count ?? 0) + 1 };
    else groups[key].count++;
  }
  const notable = Object.entries(groups)
    .sort((a, b) => a[1].d - b[1].d)
    .map(([name, g]) => `${name.replace(/_/g, ' ')}${g.count > 1 ? ` x${g.count}` : ''} (nearest ${g.d.toFixed(0)}m ${compass(pos, g.p)})`);
  lines.push(`Notable blocks: ${notable.join(', ') || 'none'}`);
  if (signs.length) lines.push(`Signs: ${signs.join('; ')}`);
  return lines.join('\n');
}
