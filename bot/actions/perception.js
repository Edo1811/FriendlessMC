import vec3 from 'vec3';
import { fmtPos, isHostile, blockIdsMatching, compass } from './util.js';
import { humansOnline } from '../state.js';

function timeOfDay(bot) {
  const t = bot.time.timeOfDay;
  if (t < 1000) return 'sunrise';
  if (t < 6000) return 'morning';
  if (t < 12000) return 'afternoon';
  if (t < 13000) return 'sunset';
  return 'night';
}

export function inventorySummary(bot) {
  const counts = {};
  for (const item of bot.inventory.items()) counts[item.name] = (counts[item.name] ?? 0) + item.count;
  const parts = Object.entries(counts).map(([name, n]) => `${name} x${n}`);
  return parts.length ? parts.join(', ') : 'empty';
}

// Everything the server is sending us (players up to ~160 blocks with the raised tracking
// ranges), nearest first, with distance and compass direction.
export function nearbyEntities(bot, radius = 160, maxMobs = 15) {
  const me = bot.entity.position;
  const seen = [];
  for (const e of Object.values(bot.entities)) {
    if (e === bot.entity || !e.position) continue;
    const d = e.position.distanceTo(me);
    if (d <= radius) seen.push({ e, d });
  }
  seen.sort((a, b) => a.d - b.d);
  const where = ({ e, d }) => `${d.toFixed(0)}m ${compass(me, e.position)}`;
  const players = seen.filter(({ e }) => e.type === 'player').map((x) => `${x.e.username} (${where(x)})`);
  const mobs = seen
    .filter(({ e }) => e.type !== 'player' && e.type !== 'object' && e.type !== 'orb' && e.type !== 'projectile' && e.name)
    .slice(0, maxMobs)
    .map((x) => `${x.e.name}${isHostile(x.e) ? ' [hostile]' : ''} (${where(x)})`);
  return { players, mobs };
}

// One compact text snapshot of everything Claude usually wants to know.
export function status(bot, state) {
  const { players, mobs } = nearbyEntities(bot);
  const outOfSight = humansOnline(bot).filter((name) => !bot.players[name]?.entity);
  const held = bot.heldItem ? `${bot.heldItem.name} x${bot.heldItem.count}` : 'nothing';
  const below = bot.blockAt(bot.entity.position.offset(0, -1, 0));
  const lines = [
    `Position: ${fmtPos(bot.entity.position)} in ${bot.game.dimension}, standing on ${below?.name ?? 'air'}`,
    `Health: ${Math.round(bot.health * 10) / 10}/20, food: ${bot.food}/20`,
    `Time: ${timeOfDay(bot)}${bot.isRaining ? ', raining' : ''}`,
    `Holding: ${held}`,
    `Inventory: ${inventorySummary(bot)}`,
    `Online players: ${humansOnline(bot).join(', ') || 'none'}`,
    `Players you can see: ${players.join(', ') || 'none'}${outOfSight.length ? ` (out of sight: ${outOfSight.join(', ')})` : ''}`,
    `Mobs you can see: ${mobs.join(', ') || 'none'}`,
    `Doing: ${state.action?.name ?? 'nothing'}${state.background ? `, ${state.background.name} in the background` : ''}`,
    `Mode: ${state.mode}${state.focus ? ` (focus for ${state.focus.by})` : ''}, op mode: ${
      state.opMode.enabled ? `ON (unlocked by ${state.opMode.by})` : 'off'
    }`,
  ];
  return lines.join('\n');
}

export function findBlocks(bot, { block, maxDistance = 48, count = 10 }) {
  const ids = blockIdsMatching(bot, block);
  if (!ids.length) return `No block type called "${block}".`;
  const found = bot.findBlocks({ matching: ids, maxDistance, count });
  if (!found.length) return `No ${block} within ${maxDistance} blocks.`;
  const me = bot.entity.position;
  return found
    .map((p) => `${bot.blockAt(p)?.name ?? block} at ${fmtPos(p)} (${p.distanceTo(me).toFixed(0)}m)`)
    .join('\n');
}

export function blockAt(bot, { x, y, z }) {
  const b = bot.blockAt(vec3(x, y, z));
  return b ? `${b.name} at ${x} ${y} ${z}` : `That block isn't loaded.`;
}
