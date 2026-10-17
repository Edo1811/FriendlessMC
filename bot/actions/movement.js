import pathfinderPkg from 'mineflayer-pathfinder';
import { abortable, sleep, playerEntity, fmtPos } from './util.js';

const { goals } = pathfinderPkg;

function stopPathing(bot) {
  bot.pathfinder.setGoal(null);
  bot.pathfinder.stop();
}

export async function goTo(bot, { x, y, z, range = 1 }, signal) {
  await abortable(signal, bot.pathfinder.goto(new goals.GoalNear(x, y, z, range)), () => stopPathing(bot));
  return `Arrived near ${x} ${y} ${z}. Now at ${fmtPos(bot.entity.position)}.`;
}

export async function goToPlayer(bot, { player, distance = 2 }, signal) {
  const target = playerEntity(bot, player);
  if (!target) return `${player} isn't close enough for me to see them.`;
  const p = target.position;
  await abortable(signal, bot.pathfinder.goto(new goals.GoalNear(p.x, p.y, p.z, distance)), () => stopPathing(bot));
  return `I'm next to ${player} now.`;
}

// Keeps following until the time is up, the player disappears, or the action is interrupted.
export async function follow(bot, { player, distance = 3, maxSeconds = 120 }, signal) {
  const target = playerEntity(bot, player);
  if (!target) return `${player} isn't close enough for me to see them.`;
  bot.pathfinder.setGoal(new goals.GoalFollow(target, distance), true);
  const until = Date.now() + maxSeconds * 1000;
  try {
    while (Date.now() < until) {
      await sleep(500, signal);
      if (!playerEntity(bot, player)) return `Lost sight of ${player}.`;
    }
    return `Followed ${player} for ${maxSeconds}s.`;
  } finally {
    stopPathing(bot);
  }
}

export async function lookAtPlayer(bot, { player }) {
  const target = playerEntity(bot, player);
  if (!target) return `${player} isn't close enough for me to see them.`;
  await bot.lookAt(target.position.offset(0, target.height ?? 1.6, 0));
  return `Looking at ${player}.`;
}

export async function jump(bot, _args, signal) {
  bot.setControlState('jump', true);
  try {
    await sleep(400, signal);
  } finally {
    bot.setControlState('jump', false);
  }
  return 'Jumped.';
}
