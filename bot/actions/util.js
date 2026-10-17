// Runs `promise` but rejects as soon as `signal` aborts, calling `cleanup` to stop the bot.
export function abortable(signal, promise, cleanup) {
  if (signal.aborted) {
    cleanup?.();
    return Promise.reject(signal.reason);
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      cleanup?.();
      reject(signal.reason);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (err) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      },
    );
  });
}

export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

// Compass direction from one position to another (north is -z, east is +x).
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export function compass(from, to) {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  if (Math.hypot(dx, dz) < 1) return 'here';
  const angle = (Math.atan2(dx, -dz) * 180) / Math.PI; // 0 = north, 90 = east
  return COMPASS[Math.round(((angle + 360) % 360) / 45) % 8];
}

export function fmtPos(p) {
  return `${Math.floor(p.x)} ${Math.floor(p.y)} ${Math.floor(p.z)}`;
}

export function playerEntity(bot, name) {
  const key = Object.keys(bot.players).find((p) => p.toLowerCase() === String(name).toLowerCase());
  return key ? bot.players[key].entity ?? null : null;
}

const HOSTILE_FALLBACK = new Set([
  'zombie', 'husk', 'drowned', 'skeleton', 'stray', 'creeper', 'spider', 'cave_spider', 'witch',
  'enderman', 'slime', 'magma_cube', 'phantom', 'pillager', 'vindicator', 'evoker', 'ravager',
  'blaze', 'ghast', 'wither_skeleton', 'piglin_brute', 'hoglin', 'zoglin', 'silverfish',
  'guardian', 'elder_guardian', 'warden', 'breeze', 'bogged', 'zombie_villager', 'vex', 'creaking',
]);

export function isHostile(entity) {
  return entity.type === 'hostile' || HOSTILE_FALLBACK.has(entity.name);
}

// Nearest entity that is a player with this name, or a mob of this type (e.g. "zombie").
export function findEntity(bot, target, maxDistance = 32) {
  const player = playerEntity(bot, target);
  if (player) return player;
  const wanted = String(target).toLowerCase().replace(/^minecraft:/, '');
  return bot.nearestEntity(
    (e) => e !== bot.entity && e.name === wanted && e.position.distanceTo(bot.entity.position) <= maxDistance,
  );
}

// Block ids matching a name. Exact name first, otherwise every block whose name contains it
// (so "log" finds oak_log, birch_log, ...).
export function blockIdsMatching(bot, name) {
  const wanted = String(name).toLowerCase().replace(/^minecraft:/, '');
  const exact = bot.registry.blocksByName[wanted];
  if (exact) return [exact.id];
  return bot.registry.blocksArray.filter((b) => b.name.includes(wanted)).map((b) => b.id);
}

export function itemByName(bot, name) {
  return bot.registry.itemsByName[String(name).toLowerCase().replace(/^minecraft:/, '')] ?? null;
}

export function inventoryItem(bot, name) {
  const wanted = String(name).toLowerCase().replace(/^minecraft:/, '');
  return bot.inventory.items().find((i) => i.name === wanted) ?? null;
}

export function countItem(bot, name) {
  return bot.inventory.items().filter((i) => i.name === name).reduce((sum, i) => sum + i.count, 0);
}
