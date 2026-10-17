import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { normalizeEnchants, patchDigTime, elytraActionName } from '../bot/compat.js';

const require = createRequire(import.meta.url);
const registry = require('prismarine-registry')('1.21.11');

test('enchantments in the 1.21 component shape become { name, lvl }', () => {
  const bot = { registry };
  const eff = registry.enchantmentsByName.efficiency.id;
  assert.deepEqual(normalizeEnchants(bot, { enchants: { enchantments: [{ id: eff, level: 5 }] } }), [{ name: 'efficiency', lvl: 5 }]);
  assert.deepEqual(normalizeEnchants(bot, { enchants: [{ name: 'aqua_affinity', lvl: 1 }] }), [{ name: 'aqua_affinity', lvl: 1 }]);
  assert.deepEqual(normalizeEnchants(bot, null), []);
});

test('digTime no longer crashes with an enchanted helmet, and counts efficiency', () => {
  const eff = registry.enchantmentsByName.efficiency.id;
  const prot = registry.enchantmentsByName.protection.id;
  let passed;
  const bot = {
    registry,
    heldItem: { type: 1, enchants: { enchantments: [{ id: eff, level: 5 }] } },
    inventory: { slots: { 5: { enchants: { enchantments: [{ id: prot, level: 4 }] } } } },
    getEquipmentDestSlot: () => 5,
    entity: { position: { offset: () => ({}) }, onGround: true, effects: {} },
    blockAt: () => ({ name: 'air' }),
    game: { gameMode: 'survival' },
  };
  patchDigTime(bot);
  bot.digTime({ digTime: (...args) => { passed = args; return 123; } });
  assert.deepEqual(passed[4], [{ name: 'efficiency', lvl: 5 }, { name: 'protection', lvl: 4 }]);
  assert.equal(passed[2], false, 'not in water');
});

test('elytra uses the action name the server version knows', () => {
  assert.equal(elytraActionName({ registry }), 'start_fall_flying');
});
