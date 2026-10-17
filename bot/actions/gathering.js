import { abortable, blockIdsMatching, countItem } from './util.js';
import { watchStuck } from './pathing.js';

// Mines `count` blocks of a type and picks up the drops. Checks for interrupts between blocks.
export async function mine(bot, { block, count = 1, maxDistance = 48 }, signal) {
  const ids = blockIdsMatching(bot, block);
  if (!ids.length) return `No block type called "${block}".`;

  const before = Object.fromEntries(bot.inventory.items().map((i) => [i.name, countItem(bot, i.name)]));
  let mined = 0;
  let failure = null;

  while (mined < count) {
    const target = bot.findBlock({ matching: ids, maxDistance });
    if (!target) {
      failure = `couldn't find more ${block} within ${maxDistance} blocks`;
      break;
    }
    const cancel = () => bot.collectBlock.cancelTask().catch(() => {});
    const stopWatching = watchStuck(bot, cancel);
    try {
      await abortable(signal, bot.collectBlock.collect(target, { ignoreNoPath: false }), cancel);
      mined++;
    } catch (err) {
      if (signal.aborted) throw err;
      failure = err.message;
      break;
    } finally {
      stopWatching();
    }
  }

  const gained = bot.inventory
    .items()
    .map((i) => i.name)
    .filter((name, idx, all) => all.indexOf(name) === idx)
    .map((name) => [name, countItem(bot, name) - (before[name] ?? 0)])
    .filter(([, diff]) => diff > 0)
    .map(([name, diff]) => `${name} +${diff}`);

  let result = `Mined ${mined}/${count} ${block}.`;
  if (gained.length) result += ` Picked up: ${gained.join(', ')}.`;
  if (failure) result += ` Stopped because: ${failure}.`;
  return result;
}
