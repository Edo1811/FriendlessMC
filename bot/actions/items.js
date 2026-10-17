import { inventoryItem, itemByName, playerEntity, countItem } from './util.js';
import { pathTo, near } from './pathing.js';

async function walkTo(bot, pos, range, signal) {
  await pathTo(bot, near(pos.x, pos.y, pos.z, range), signal);
}

export async function equip(bot, { item, slot = 'hand' }) {
  const stack = inventoryItem(bot, item);
  if (!stack) return `I don't have any ${item}.`;
  await bot.equip(stack, slot);
  return `Equipped ${item} (${slot}).`;
}

export async function craft(bot, { item, count = 1 }, signal) {
  const info = itemByName(bot, item);
  if (!info) return `There's no item called "${item}".`;

  let table = null;
  let recipe = bot.recipesFor(info.id, null, 1, null)[0];
  if (!recipe) {
    table = bot.findBlock({ matching: bot.registry.blocksByName.crafting_table.id, maxDistance: 32 });
    if (!table) {
      const any = bot.recipesAll(info.id, null, true).length > 0;
      return any
        ? `I need a crafting table nearby to craft ${item} (or I'm missing ingredients).`
        : `I can't craft ${item} by hand and there's no crafting table nearby.`;
    }
    recipe = bot.recipesFor(info.id, null, 1, table)[0];
    if (!recipe) return `I don't have the ingredients for ${item}.`;
    await walkTo(bot, table.position, 3, signal);
  }

  // `count` is how many items we want; a recipe can produce several per craft
  const perCraft = recipe.result.count || 1;
  const times = Math.ceil(count / perCraft);
  const before = countItem(bot, info.name);
  try {
    await bot.craft(recipe, times, table ?? undefined);
  } catch (err) {
    const made = countItem(bot, info.name) - before;
    return `Crafted ${made} ${item} before it failed: ${err.message}`;
  }
  return `Crafted ${countItem(bot, info.name) - before} ${item}.`;
}

export async function give(bot, { player, item, count = 1 }, signal) {
  const stack = inventoryItem(bot, item);
  if (!stack) return `I don't have any ${item}.`;
  const target = playerEntity(bot, player);
  if (!target) return `${player} isn't close enough for me to see them.`;
  await walkTo(bot, target.position, 2, signal);
  await bot.lookAt(target.position.offset(0, 1.6, 0));
  const amount = Math.min(count, countItem(bot, stack.name));
  await bot.toss(stack.type, null, amount);
  return `Threw ${amount} ${item} to ${player}.`;
}

export async function drop(bot, { item, count }) {
  const stack = inventoryItem(bot, item);
  if (!stack) return `I don't have any ${item}.`;
  const amount = Math.min(count ?? countItem(bot, stack.name), countItem(bot, stack.name));
  await bot.toss(stack.type, null, amount);
  return `Dropped ${amount} ${item}.`;
}

export async function eat(bot) {
  if (bot.food >= 20) return `I'm not hungry.`;
  try {
    await bot.autoEat.eat();
    return `Ate something. Food is now ${bot.food}/20.`;
  } catch (err) {
    return `Couldn't eat: ${err.message}`;
  }
}

export async function sleepInBed(bot, _args, signal) {
  const bed = bot.findBlock({ matching: (b) => bot.isABed(b), maxDistance: 32 });
  if (!bed) return 'No bed nearby.';
  await walkTo(bot, bed.position, 2, signal);
  try {
    await bot.sleep(bed);
    return 'Sleeping. I wake up when the night is over or someone talks to me.';
  } catch (err) {
    return `Can't sleep: ${err.message}`;
  }
}
