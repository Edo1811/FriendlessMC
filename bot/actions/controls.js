import vec3 from 'vec3';
import { abortable, sleep, findEntity, fmtPos, playerEntity, inventoryItem } from './util.js';
import { stopPathing } from './pathing.js';
import { startElytraFlying } from '../compat.js';

export const CONTROL_KEYS = ['forward', 'back', 'left', 'right', 'jump', 'sprint', 'sneak'];

const rad = (deg) => (deg * Math.PI) / 180;
const deg = (r) => Math.round((r * 180) / Math.PI);

// Holds keys like a player would, for `ms` milliseconds.
// The pathfinder and pvp plugins also drive the keys, so they're cleared first and the keys
// are pressed again every tick while held.
export async function control(bot, { keys, ms = 500, yaw }, signal) {
  stopPathing(bot);
  bot.pvp?.stop();
  if (yaw !== undefined) await bot.look(rad(180 - yaw), bot.entity.pitch, true);
  const press = () => keys.forEach((key) => bot.setControlState(key, true));
  press();
  bot.on('physicsTick', press);
  const start = bot.entity.position.clone();
  try {
    await sleep(ms, signal);
  } finally {
    bot.removeListener('physicsTick', press);
    bot.clearControlStates();
  }
  return `Held ${keys.join('+')} for ${ms}ms. Moved from ${fmtPos(start)} to ${fmtPos(bot.entity.position)}.`;
}

// Yaw/pitch are in Minecraft's F3 convention (yaw 0 = south, 90 = west, 180 = north, 270 = east;
// pitch 90 = straight down). Mineflayer uses north = 0, counter-clockwise, and up = positive pitch.
export async function look(bot, { yaw, pitch, x, y, z, player }) {
  if (player) {
    const target = playerEntity(bot, player);
    if (!target) return `${player} isn't close enough for me to see them.`;
    await bot.lookAt(target.position.offset(0, target.height ?? 1.6, 0), true);
  } else if (x !== undefined && y !== undefined && z !== undefined) {
    await bot.lookAt(vec3(x + 0.5, y + 0.5, z + 0.5), true);
  } else {
    await bot.look(yaw === undefined ? bot.entity.yaw : rad(180 - yaw), pitch === undefined ? bot.entity.pitch : rad(-pitch), true);
  }
  const looking = bot.blockAtCursor(5);
  return `Facing yaw ${(180 - deg(bot.entity.yaw) + 360) % 360}, pitch ${-deg(bot.entity.pitch)}.` +
    (looking ? ` Looking at ${looking.name} at ${fmtPos(looking.position)}.` : '');
}

// One left click: hit an entity if given, otherwise just swing.
export async function hit(bot, { target }) {
  if (!target) {
    bot.swingArm('right');
    return 'Swung my arm.';
  }
  const entity = findEntity(bot, target, 6);
  if (!entity) return `No ${target} within reach.`;
  await bot.lookAt(entity.position.offset(0, (entity.height ?? 1) * 0.8, 0), true);
  bot.attack(entity);
  return `Hit ${entity.username ?? entity.name}.`;
}

// Survival flying: needs an elytra (worn or in inventory). Fireworks boost if we have them.
export async function elytraFly(bot, { x, y, z }, signal) {
  const worn = bot.inventory.slots[bot.getEquipmentDestSlot('torso')];
  if (worn?.name !== 'elytra') {
    const elytra = inventoryItem(bot, 'elytra');
    if (!elytra) return "I don't have an elytra.";
    await bot.equip(elytra, 'torso');
  }
  const target = vec3(x, y, z);
  const rocket = () => inventoryItem(bot, 'firework_rocket');

  if (bot.entity.onGround) {
    bot.setControlState('jump', true);
    await sleep(300, signal);
    bot.setControlState('jump', false);
    await sleep(150, signal);
  }
  startElytraFlying(bot);

  const deadline = Date.now() + 120_000;
  let lastBoost = 0;
  try {
    while (Date.now() < deadline) {
      const pos = bot.entity.position;
      const flat = Math.hypot(target.x - pos.x, target.z - pos.z);
      if (flat < 8) break;
      if (bot.entity.onGround) return `Landed at ${fmtPos(pos)}, ${flat.toFixed(0)} blocks short.`;
      await abortable(signal, bot.lookAt(vec3(target.x, Math.max(target.y, pos.y), target.z), true));
      if (rocket() && Date.now() - lastBoost > 2500 && (pos.y < target.y + 10 || bot.entity.velocity.norm() < 0.6)) {
        await bot.equip(rocket(), 'hand');
        bot.activateItem();
        lastBoost = Date.now();
      }
      await sleep(250, signal);
    }
  } finally {
    bot.clearControlStates();
  }
  return `Flew to around ${fmtPos(bot.entity.position)}.`;
}

// Creative/spectator flying straight to a point.
export async function flyTo(bot, { x, y, z }, signal) {
  if (bot.game.gameMode !== 'creative' && bot.game.gameMode !== 'spectator') {
    return `I can only fly like that in creative (I'm in ${bot.game.gameMode}). Use an elytra or op mode /gamemode.`;
  }
  await abortable(signal, bot.creative.flyTo(vec3(x + 0.5, y, z + 0.5)), () => bot.creative.stopFlying());
  return `Flew to ${fmtPos(bot.entity.position)}.`;
}

export function stopFlying(bot) {
  bot.creative.stopFlying();
  return 'Stopped flying.';
}
