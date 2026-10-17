import pathfinderPkg from 'mineflayer-pathfinder';
import { abortable, sleep } from './util.js';

const { goals } = pathfinderPkg;

const CHECK_MS = 1000;
const STUCK_MS = 2500;
const MIN_PROGRESS = 0.3;
const MAX_UNSTICKS = 4;

export function stopPathing(bot) {
  bot.pathfinder.setGoal(null);
  bot.pathfinder.stop();
  bot.clearControlStates();
}

// Walk forward + jump for a moment in the direction we're facing. Gets the bot up
// 1-block steps and over edges the pathfinder sometimes stalls on.
export async function unstick(bot, attempt = 0) {
  if (attempt % 2 === 1) await bot.look(bot.entity.yaw + Math.PI / 2, 0, true);
  bot.setControlState('forward', true);
  bot.setControlState('jump', true);
  if (attempt >= 2) bot.setControlState('sprint', true);
  await sleep(450);
  bot.clearControlStates();
}

// Watches a running path and nudges the bot when it stops making progress.
// Returns a function that stops watching. Calls onGiveUp after too many tries.
export function watchStuck(bot, onGiveUp) {
  let last = bot.entity.position.clone();
  let lastMoved = Date.now();
  let unsticks = 0;
  let busy = false;
  const timer = setInterval(async () => {
    if (busy || !bot.entity) return;
    const pos = bot.entity.position;
    if (pos.distanceTo(last) > MIN_PROGRESS) {
      last = pos.clone();
      lastMoved = Date.now();
      return;
    }
    if (Date.now() - lastMoved < STUCK_MS || !bot.pathfinder.isMoving()) return;
    if (unsticks >= MAX_UNSTICKS) {
      clearInterval(timer);
      onGiveUp?.();
      return;
    }
    busy = true;
    try {
      await unstick(bot, unsticks++);
    } finally {
      lastMoved = Date.now();
      busy = false;
    }
  }, CHECK_MS);
  return () => clearInterval(timer);
}

// pathfinder.goto with interrupt support and the stuck watcher.
export async function pathTo(bot, goal, signal) {
  let gaveUp = false;
  const stopWatching = watchStuck(bot, () => {
    gaveUp = true;
    stopPathing(bot);
  });
  try {
    await abortable(signal, bot.pathfinder.goto(goal), () => stopPathing(bot));
  } catch (err) {
    if (gaveUp) throw new Error("I'm stuck and can't find a way through");
    throw err;
  } finally {
    stopWatching();
  }
}

export function near(x, y, z, range) {
  return new goals.GoalNear(x, y, z, range);
}

export { goals };
