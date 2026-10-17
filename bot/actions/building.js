import pathfinderPkg from 'mineflayer-pathfinder';
import vec3 from 'vec3';
import { abortable, inventoryItem } from './util.js';

const { goals } = pathfinderPkg;

const FACES = [
  vec3(0, -1, 0), vec3(0, 1, 0), vec3(1, 0, 0), vec3(-1, 0, 0), vec3(0, 0, 1), vec3(0, 0, -1),
];

function isReplaceable(block) {
  return !block || block.name === 'air' || block.name === 'cave_air' || block.name === 'water' ||
    block.name === 'lava' || block.name === 'short_grass' || block.name === 'tall_grass' || block.name === 'snow';
}

async function moveWithinReach(bot, pos, signal) {
  if (bot.entity.position.distanceTo(pos.offset(0.5, 0.5, 0.5)) <= 4) return;
  await abortable(signal, bot.pathfinder.goto(new goals.GoalNear(pos.x, pos.y, pos.z, 3)), () => {
    bot.pathfinder.setGoal(null);
    bot.pathfinder.stop();
  });
}

async function placeOne(bot, { item, x, y, z }, signal) {
  const pos = vec3(Math.floor(x), Math.floor(y), Math.floor(z));
  const existing = bot.blockAt(pos);
  if (existing && !isReplaceable(existing)) return `${pos}: already ${existing.name} there`;

  const stack = inventoryItem(bot, item);
  if (!stack) return `${pos}: I don't have any ${item}`;

  await moveWithinReach(bot, pos, signal);

  const feet = bot.entity.position.floored();
  if (feet.equals(pos) || feet.offset(0, 1, 0).equals(pos)) return `${pos}: I'm standing in that spot`;

  for (const face of FACES) {
    const ref = bot.blockAt(pos.plus(face));
    if (ref && !isReplaceable(ref) && ref.boundingBox === 'block') {
      await bot.equip(stack, 'hand');
      await bot.placeBlock(ref, face.scaled(-1));
      return null;
    }
  }
  return `${pos}: nothing solid next to it to place against`;
}

// Places a list of blocks in order. Stops on interrupt; reports any that failed.
export async function placeBlocks(bot, { blocks }, signal) {
  const problems = [];
  let placed = 0;
  for (const b of blocks) {
    if (signal.aborted) throw signal.reason;
    try {
      const problem = await placeOne(bot, b, signal);
      if (problem) problems.push(problem);
      else placed++;
    } catch (err) {
      if (signal.aborted) throw err;
      problems.push(`${b.x} ${b.y} ${b.z}: ${err.message}`);
    }
  }
  let result = `Placed ${placed}/${blocks.length} blocks.`;
  if (problems.length) result += ` Problems:\n${problems.slice(0, 15).join('\n')}`;
  return result;
}

export async function dig(bot, { x, y, z }, signal) {
  const pos = vec3(Math.floor(x), Math.floor(y), Math.floor(z));
  const block = bot.blockAt(pos);
  if (!block || block.name === 'air') return `There's nothing at ${x} ${y} ${z}.`;
  await moveWithinReach(bot, pos, signal);
  const tool = bot.pathfinder.bestHarvestTool(block);
  if (tool) await bot.equip(tool, 'hand');
  await abortable(signal, bot.dig(block), () => bot.stopDigging());
  return `Broke the ${block.name} at ${x} ${y} ${z}.`;
}
