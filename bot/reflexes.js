import { isHostile } from './actions/util.js';
import { equipBestWeapon } from './actions/combat.js';

// Things the bot does on its own, without spending a Claude thought.
export function attachReflexes(ctx) {
  const { bot, state } = ctx;

  bot.autoEat.setOpts({ minHunger: 14, bannedFood: ['rotten_flesh', 'spider_eye', 'poisonous_potato', 'pufferfish'] });
  bot.autoEat.enableAuto();

  // Hit back at a hostile mob that hurts us, unless Claude is busy with something.
  bot.on('entityHurt', async (entity) => {
    if (entity !== bot.entity || state.action || bot.pvp.target) return;
    const attacker = bot.nearestEntity((e) => isHostile(e) && e.position.distanceTo(bot.entity.position) < 5);
    if (!attacker) return;
    await equipBestWeapon(bot).catch(() => {});
    bot.pvp.attack(attacker);
  });
}
