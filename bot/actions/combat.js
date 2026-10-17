import { abortable, findEntity } from './util.js';

const WEAPON_ORDER = [
  'netherite_sword', 'diamond_sword', 'netherite_axe', 'diamond_axe', 'iron_sword', 'iron_axe',
  'stone_sword', 'stone_axe', 'golden_sword', 'wooden_sword', 'golden_axe', 'wooden_axe',
];

export async function equipBestWeapon(bot) {
  for (const name of WEAPON_ORDER) {
    const item = bot.inventory.items().find((i) => i.name === name);
    if (item) {
      await bot.equip(item, 'hand');
      return name;
    }
  }
  return null;
}

// Fights a mob type or a player until it's dead, out of range, 60s pass, or we're interrupted.
export async function attack(bot, { target, maxSeconds = 60 }, signal) {
  const entity = findEntity(bot, target);
  if (!entity) return `No ${target} nearby.`;
  const weapon = await equipBestWeapon(bot);

  let onStop;
  let timer;
  const done = new Promise((resolve) => {
    onStop = () => resolve('stopped');
    bot.once('stoppedAttacking', onStop);
    timer = setTimeout(() => resolve('timeout'), maxSeconds * 1000);
  });

  bot.pvp.attack(entity);
  let outcome;
  try {
    outcome = await abortable(signal, done, () => bot.pvp.stop());
  } finally {
    clearTimeout(timer);
    bot.removeListener('stoppedAttacking', onStop);
  }
  if (outcome === 'timeout') await bot.pvp.stop();

  const name = entity.username ?? entity.name;
  const alive = bot.entities[entity.id];
  if (!alive) return `Defeated ${name}${weapon ? ` with my ${weapon}` : ''}.`;
  return outcome === 'timeout' ? `Fought ${name} for ${maxSeconds}s, it's still alive.` : `Stopped fighting ${name}.`;
}
