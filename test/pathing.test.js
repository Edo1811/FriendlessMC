import { test } from 'node:test';
import assert from 'node:assert/strict';
import vec3 from 'vec3';
import { watchStuck } from '../bot/actions/pathing.js';

function fakeBot() {
  const pressed = [];
  return {
    pressed,
    entity: { position: vec3(0, 64, 0), yaw: 0 },
    pathfinder: { isMoving: () => true },
    setControlState: (key, on) => on && pressed.push(key),
    clearControlStates: () => {},
    look: async () => {},
  };
}

test('a bot that stops moving mid-path gets nudged with jump+forward', async () => {
  const bot = fakeBot();
  const stop = watchStuck(bot);
  await new Promise((r) => setTimeout(r, 4200));
  stop();
  assert.ok(bot.pressed.includes('jump'), 'jumped');
  assert.ok(bot.pressed.includes('forward'), 'walked forward');
});

test('a bot that keeps moving is left alone', async () => {
  const bot = fakeBot();
  const timer = setInterval(() => (bot.entity.position = bot.entity.position.offset(1, 0, 0)), 300);
  const stop = watchStuck(bot);
  await new Promise((r) => setTimeout(r, 4200));
  stop();
  clearInterval(timer);
  assert.deepEqual(bot.pressed, []);
});
