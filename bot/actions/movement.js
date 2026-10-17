import { playerEntity, fmtPos } from './util.js';
import { pathTo, near, stopPathing, watchStuck } from './pathing.js';

const FOLLOW_TICK_MS = 400;
const MAX_NO_PATH = 6;

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

// Follows a player in the background, so Claude can keep chatting and thinking meanwhile.
// It walks to wherever the player was last seen, so it picks them up again after losing sight.
// Returns { name, stop() }, or { error }. onEnd(reason) runs if it ends on its own.
export function startFollow(bot, { player, distance = 3 }, onEnd) {
  const name = Object.keys(bot.players).find((p) => p.toLowerCase() === String(player).toLowerCase());
  if (!name) return { error: `${player} isn't online.` };
  const first = playerEntity(bot, name);
  if (!first) return { error: `I can't see ${name} from here. Ask where they are, or go_to their coordinates.` };

  let lastSeen = first.position.clone();
  let goalPos = null;
  let noPath = 0;
  let stopped = false;

  const onPathUpdate = (r) => {
    noPath = r.status === 'noPath' ? noPath + 1 : 0;
    if (noPath >= MAX_NO_PATH) end(`I can't find a way to ${name}`);
  };

  const tick = () => {
    if (stopped || !bot.entity) return;
    if (!bot.players[name]) return end(`${name} left the game`);
    if (bot.pvp?.target) return; // a reflex fight has the pathfinder right now

    const entity = playerEntity(bot, name);
    if (entity) lastSeen = entity.position.clone();
    const dist = bot.entity.position.distanceTo(lastSeen);
    if (!entity && dist <= distance + 1) return end(`lost sight of ${name} near ${fmtPos(lastSeen)}`);

    const targetMoved = !goalPos || goalPos.distanceTo(lastSeen) > 1.5;
    if (dist > distance + 1 && (targetMoved || !bot.pathfinder.isMoving())) {
      goalPos = lastSeen.clone();
      bot.pathfinder.setGoal(near(goalPos.x, goalPos.y, goalPos.z, distance));
    }
  };

  const timer = setInterval(tick, FOLLOW_TICK_MS);
  const stopWatching = watchStuck(bot, () => end('I got stuck'));
  bot.on('path_update', onPathUpdate);
  tick();

  function cleanup() {
    stopped = true;
    clearInterval(timer);
    stopWatching();
    bot.removeListener('path_update', onPathUpdate);
    stopPathing(bot);
  }

  function end(reason) {
    if (stopped) return;
    cleanup();
    onEnd?.(reason);
  }

  return {
    name: `following ${name}`,
    stop: () => {
      if (!stopped) cleanup();
    },
  };
}
