import vec3 from 'vec3';
import { abortable, sleep, findEntity, fmtPos, inventoryItem, itemByName, countItem } from './util.js';
import { pathTo, near } from './pathing.js';
import { moveWithinReach } from './building.js';

function blockAtCoords(bot, x, y, z) {
  const block = bot.blockAt(vec3(Math.floor(x), Math.floor(y), Math.floor(z)));
  if (!block) throw new Error(`The block at ${x} ${y} ${z} isn't loaded.`);
  return block;
}

async function reachEntity(bot, target, signal, range = 3) {
  const entity = findEntity(bot, target, 48);
  if (!entity) throw new Error(`No ${target} nearby.`);
  if (entity.position.distanceTo(bot.entity.position) > range) {
    const p = entity.position;
    await pathTo(bot, near(p.x, p.y, p.z, range - 1), signal);
  }
  return entity;
}

const describeItems = (items) => {
  const counts = {};
  for (const i of items) counts[i.name] = (counts[i.name] ?? 0) + i.count;
  const parts = Object.entries(counts).map(([n, c]) => `${n} x${c}`);
  return parts.length ? parts.join(', ') : 'empty';
};

// Right click with the held item (eat, drink, throw, bow, shield, bucket...).
// hold_ms keeps the button down, e.g. ~1000 to fully draw a bow.
export async function useItem(bot, { offhand = false, holdMs = 0 }, signal) {
  const item = offhand ? bot.inventory.slots[45] : bot.heldItem;
  if (!item) return `I'm not holding anything${offhand ? ' in my off-hand' : ''}.`;
  bot.activateItem(offhand);
  if (holdMs > 0) {
    try {
      await sleep(holdMs, signal);
    } finally {
      bot.deactivateItem();
    }
  }
  return `Used ${item.name}${holdMs ? ` (held ${holdMs}ms)` : ''}.`;
}

// Right click a block: doors, levers, buttons, beds, note blocks, crafting tables, etc.
export async function useBlock(bot, { x, y, z }, signal) {
  const block = blockAtCoords(bot, x, y, z);
  await moveWithinReach(bot, block.position, signal);
  await bot.activateBlock(block);
  await sleep(250, signal);
  const after = bot.blockAt(block.position);
  const props = after?.getProperties?.() ?? {};
  const state = Object.entries(props).map(([k, v]) => `${k}=${v}`).join(', ');
  return `Right-clicked ${block.name} at ${fmtPos(block.position)}.${state ? ` Now: ${state}.` : ''}`;
}

// Right click an entity: breed, shear, name tag, leash, trade window etc.
export async function useEntity(bot, { target }, signal) {
  const entity = await reachEntity(bot, target, signal);
  await bot.lookAt(entity.position.offset(0, (entity.height ?? 1) / 2, 0), true);
  await bot.activateEntity(entity);
  return `Right-clicked ${entity.username ?? entity.name}${bot.heldItem ? ` holding ${bot.heldItem.name}` : ''}.`;
}

export async function mount(bot, { target }, signal) {
  const entity = await reachEntity(bot, target, signal);
  bot.mount(entity);
  await sleep(500, signal);
  return bot.vehicle ? `Riding the ${entity.name}.` : `Couldn't get on the ${entity.name}.`;
}

export function dismount(bot) {
  if (!bot.vehicle) return "I'm not riding anything.";
  bot.dismount();
  return 'Got off.';
}

// Chests, barrels, shulker boxes, ender chests, hoppers, dispensers...
// action: 'look' lists contents, 'take' withdraws, 'put' deposits.
export async function container(bot, { x, y, z, action, item, count }, signal) {
  const block = blockAtCoords(bot, x, y, z);
  await moveWithinReach(bot, block.position, signal);
  const window = await bot.openContainer(block);
  try {
    if (action === 'look') return `${block.name} contains: ${describeItems(window.containerItems())}`;
    const info = itemByName(bot, item);
    if (!info) return `There's no item called "${item}".`;
    if (action === 'take') {
      const available = window.containerItems().filter((i) => i.name === info.name).reduce((s, i) => s + i.count, 0);
      if (!available) return `There's no ${item} in the ${block.name}.`;
      const n = Math.min(count ?? available, available);
      await window.withdraw(info.id, null, n);
      return `Took ${n} ${item}.`;
    }
    const have = countItem(bot, info.name);
    if (!have) return `I don't have any ${item}.`;
    const n = Math.min(count ?? have, have);
    await window.deposit(info.id, null, n);
    return `Put ${n} ${item} in the ${block.name}.`;
  } finally {
    window.close();
  }
}

// Furnace, smoker or blast furnace. 'load' puts input/fuel in, 'collect' takes the output, 'check' reports.
export async function furnace(bot, { x, y, z, action, input, fuel, count = 1 }, signal) {
  const block = blockAtCoords(bot, x, y, z);
  await moveWithinReach(bot, block.position, signal);
  const f = await bot.openFurnace(block);
  try {
    const report = () => {
      const show = (i) => (i ? `${i.name} x${i.count}` : 'empty');
      return `input: ${show(f.inputItem())}, fuel: ${show(f.fuelItem())}, output: ${show(f.outputItem())}`;
    };
    if (action === 'load') {
      if (input) {
        const stack = inventoryItem(bot, input);
        if (!stack) return `I don't have any ${input}.`;
        await f.putInput(stack.type, null, Math.min(count, countItem(bot, stack.name)));
      }
      if (fuel) {
        const stack = inventoryItem(bot, fuel);
        if (!stack) return `I don't have any ${fuel}.`;
        const needed = Math.max(1, Math.ceil(count / 8));
        await f.putFuel(stack.type, null, Math.min(needed, countItem(bot, stack.name)));
      }
      return `Loaded the ${block.name}. ${report()}. Each item takes about 10s (5s in a smoker/blast furnace).`;
    }
    if (action === 'collect') {
      if (!f.outputItem()) return `Nothing to collect yet. ${report()}`;
      const out = await f.takeOutput();
      return `Collected ${out.count} ${out.name}.`;
    }
    return report();
  } finally {
    f.close();
  }
}

// Villager trading: without `trade_index` it lists the trades, with it it trades `times` times.
export async function trade(bot, { target = 'villager', tradeIndex, times = 1 }, signal) {
  const entity = await reachEntity(bot, target, signal);
  const villager = await bot.openVillager(entity);
  try {
    if (tradeIndex === undefined) {
      if (!villager.trades.length) return 'This villager has no trades.';
      return villager.trades
        .map((t, i) => {
          const cost = [t.inputItem1, t.inputItem2].filter(Boolean).map((it) => `${it.count} ${it.name}`).join(' + ');
          return `${i}: ${cost} -> ${t.outputItem.count} ${t.outputItem.name}${t.tradeDisabled ? ' (sold out)' : ''}`;
        })
        .join('\n');
    }
    await bot.trade(villager, tradeIndex, times);
    const t = villager.trades[tradeIndex];
    return `Traded ${times}x for ${t.outputItem.name}.`;
  } finally {
    villager.close();
  }
}

export async function fish(bot, { maxSeconds = 60 }, signal) {
  const rod = inventoryItem(bot, 'fishing_rod');
  if (!rod) return "I don't have a fishing rod.";
  await bot.equip(rod, 'hand');
  const before = bot.inventory.items().map((i) => `${i.name}:${i.count}`).join();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('nothing bit')), maxSeconds * 1000);
  });
  const fishing = bot.fish();
  fishing.catch(() => {}); // it rejects later if we reel in early
  try {
    await abortable(signal, Promise.race([fishing, timeout]), () => bot.activateItem());
  } catch (err) {
    if (signal.aborted) throw err;
    bot.activateItem(); // reel the line back in
    return `No luck: ${err.message}.`;
  } finally {
    clearTimeout(timer);
  }
  await sleep(500, signal);
  const after = bot.inventory.items().map((i) => `${i.name}:${i.count}`).join();
  return before === after ? 'Reeled something in.' : `Caught something! Inventory now: ${describeItems(bot.inventory.items())}`;
}
