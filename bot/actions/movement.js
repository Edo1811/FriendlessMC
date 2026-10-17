import { sleep, playerEntity, fmtPos } from './util.js';
import { pathTo, near, goals, stopPathing, watchStuck } from './pathing.js';

export async function goTo(bot, { x, y, z, range = 1 }, signal) {
  await pathTo(bot, near(x, y, z, range), signal);
  return `Arrived near ${x} ${y} ${z}. Now at ${fmtPos(bot.entity.position)}.`;
}

export async function goToPlayer(bot, { player, distance = 2 }, signal) {
  const target = playerEntity(bot, player);
  if (!target) return `${player} isn't close enough for me to see them.`;
  const p = target.position;
  await pathTo(bot, near(p.x, p.y, p.z, distance), signal);
  return `I'm next to ${player} now.`;
}

// Keeps following until the time is up, the player disappears, or the action is interrupted.
export async function follow(bot, { player, distance = 3, maxSeconds = 120 }, signal) {
  const target = playerEntity(bot, player);
  if (!target) return `${player} isn't close enough for me to see them.`;
  bot.pathfinder.setGoal(new goals.GoalFollow(target, distance), true);
  let stuck = false;
  const stopWatching = watchStuck(bot, () => (stuck = true));
  const until = Date.now() + maxSeconds * 1000;
  try {
    while (Date.now() < until) {
      await sleep(500, signal);
      if (stuck) return `Got stuck following ${player}.`;
      if (!playerEntity(bot, player)) return `Lost sight of ${player}.`;
    }
    return `Followed ${player} for ${maxSeconds}s.`;
  } finally {
    stopWatching();
    stopPathing(bot);
  }
}
