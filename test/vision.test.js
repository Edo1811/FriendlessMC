import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import vec3 from 'vec3';
import { createStateTranslator, translateChunkJson } from '../bot/vision/translate.js';
import { screenshotViews } from '../bot/vision/views.js';
import { raiseTrackingRanges } from '../lib/spigot.js';
import { compass } from '../bot/actions/util.js';

const require = createRequire(import.meta.url);

test('1.21.11 chunks are translated so the 1.21.4 renderer reads the right blocks', () => {
  const Chunk11 = require('prismarine-chunk')('1.21.11');
  const Chunk4 = require('prismarine-chunk')('1.21.4');
  const B11 = require('prismarine-block')('1.21.11');
  const md = require('minecraft-data')('1.21.11');
  const col = new Chunk11({ minY: -64, worldHeight: 384 });
  const put = (x, y, z, name, props = {}) => col.setBlockStateId(vec3(x, y, z), B11.fromProperties(name, props, 0).stateId);
  put(0, 64, 0, 'diamond_block');
  put(1, 64, 0, 'oak_stairs', { facing: 'east', half: 'bottom', shape: 'straight', waterlogged: false });
  put(2, 64, 0, 'leaf_litter', { facing: 'north', segment_amount: '1' });
  // more than 256 different states in one section: a "direct" container
  let i = 0;
  for (const b of md.blocksArray) {
    for (let s = b.minStateId; s <= b.maxStateId && i < 400; s++, i++) {
      col.setBlockStateId(vec3(i % 16, 80 + Math.floor(i / 256), Math.floor(i / 16) % 16), s);
    }
    if (i >= 400) break;
  }
  const expected = col.getBlock(vec3(7, 80, 3)).name;

  const out = Chunk4.fromJson(translateChunkJson(col.toJson(), createStateTranslator('1.21.11', '1.21.4')));
  assert.equal(out.getBlock(vec3(0, 64, 0)).name, 'diamond_block');
  assert.equal(out.getBlock(vec3(1, 64, 0)).getProperties().facing, 'east');
  assert.equal(out.getBlock(vec3(2, 64, 0)).name, 'air', 'newer plant becomes air');
  assert.equal(out.getBlock(vec3(7, 80, 3)).name, expected, 'direct sections survive');
});

test('screenshot angles: panorama, toward a player, F3 yaw', () => {
  const bot = { entity: { position: vec3(0, 64, 0), yaw: 0, pitch: 0, eyeHeight: 1.62 }, players: { Edo: { entity: { position: vec3(10, 64, 0), height: 1.8 } } } };
  assert.equal(screenshotViews(bot, { panorama: true }).length, 4);
  assert.equal(screenshotViews(bot, { player: 'edo' })[0].yaw, -Math.PI / 2);
  assert.equal(screenshotViews(bot, { yaw: 270 })[0].label, 'looking east');
  assert.throws(() => screenshotViews(bot, { player: 'Luca' }), /isn't close enough/);
});

test('compass directions (north is -z, east is +x)', () => {
  const o = { x: 0, z: 0 };
  assert.equal(compass(o, { x: 0, z: -10 }), 'N');
  assert.equal(compass(o, { x: 10, z: 0 }), 'E');
  assert.equal(compass(o, { x: -10, z: 10 }), 'SW');
});

test('spigot.yml tracking ranges are raised, never lowered', () => {
  const yaml = [
    'world-settings:',
    '  default:',
    '    entity-tracking-range:',
    '      players: 48',
    '      animals: 200',
    '      monsters: 96',
    '      misc: 32',
    '      display: 128',
    '    ticks-per:',
    '      hopper-transfer: 8',
  ].join('\n');
  const { yaml: out, changed } = raiseTrackingRanges(yaml);
  assert.equal(changed, true);
  assert.match(out, /players: 160/);
  assert.match(out, /animals: 200/);
  assert.match(out, /monsters: 128/);
  assert.match(out, /misc: 96/);
  assert.match(out, /hopper-transfer: 8/);
  assert.equal(raiseTrackingRanges(out).changed, false);
});
