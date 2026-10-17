// Patches for mineflayer bugs on newer Minecraft versions (seen on 1.21.11).

// 1.20.5+ items keep enchantments in a component shaped { enchantments: [{ id, level }] },
// but mineflayer's dig-time code expects an array of { name, lvl } and crashes with
// "enchantments.concat is not a function". That also froze the pathfinder whenever a path
// needed a block broken, since it retried the failing dig forever.
export function normalizeEnchants(bot, item) {
  if (!item) return [];
  let raw;
  try {
    raw = item.enchants;
  } catch {
    return [];
  }
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.enchantments) ? raw.enchantments : [];
  return list.map((e) => ({
    name: e.name ?? bot.registry.enchantments?.[e.id]?.name ?? null,
    lvl: e.lvl ?? e.level ?? 0,
  }));
}

export function patchDigTime(bot) {
  bot.digTime = (block) => {
    const held = bot.heldItem;
    const head = bot.inventory.slots[bot.getEquipmentDestSlot('head')];
    const enchantments = [...normalizeEnchants(bot, held), ...normalizeEnchants(bot, head)];
    const eye = bot.entity.position && bot.blockAt(bot.entity.position.offset(0, bot.entity.eyeHeight ?? 1.62, 0));
    return block.digTime(
      held ? held.type : null,
      bot.game.gameMode === 'creative',
      ['water', 'flowing_water'].includes(eye?.name),
      !bot.entity.onGround,
      enchantments,
      bot.entity.effects,
    );
  };
}

// 1.21.6+ renamed the entity_action "start_elytra_flying" to "start_fall_flying". mineflayer
// still sends the old name, which serializes into a broken packet and gets the bot kicked
// ("accept_teleportation was larger than I expected").
export function elytraActionName(bot) {
  const mappings = bot.registry.protocol?.play?.toServer?.types?.packet_entity_action?.[1]
    ?.find((f) => f.name === 'actionId')?.type?.[1]?.mappings;
  if (!mappings) return 'start_elytra_flying';
  const names = Object.values(mappings);
  return names.find((n) => n === 'start_fall_flying' || n === 'start_elytra_flying') ?? 'start_elytra_flying';
}

export function startElytraFlying(bot) {
  if (bot.entity.onGround) throw new Error('Need to be in the air to open the elytra.');
  const torso = bot.inventory.slots[bot.getEquipmentDestSlot('torso')];
  if (torso?.name !== 'elytra') throw new Error('Not wearing an elytra.');
  bot._client.write('entity_action', {
    entityId: bot.entity.id,
    actionId: bot.supportFeature('entityActionUsesStringMapper') ? elytraActionName(bot) : 8,
    jumpBoost: 0,
  });
}

export function applyCompatPatches(bot) {
  patchDigTime(bot);
}
