import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { attachEvents } from '../bot/events.js';
import { createState } from '../bot/state.js';
import { ChatLog } from '../bot/chat.js';

function setup(players = ['Edo']) {
  const bot = new EventEmitter();
  bot.username = 'Claude';
  bot.health = undefined; // not known yet right after spawning
  bot.players = Object.fromEntries([['Claude', {}], ...players.map((p) => [p, {}])]);
  const config = { ops: ['Edo'] };
  const state = createState(config);
  state.mode = 'asleep'; // keeps the mob-scan timer quiet
  const wakes = [];
  const ctx = { bot, config, state, chat: new ChatLog(), brain: { wake: (r) => wakes.push(r) }, modes: { noteActivity() {} } };
  const detach = attachEvents(ctx);
  return { bot, state, wakes, detach };
}

test('no NaN damage when health arrives after spawning; damage shows decimals', () => {
  const { bot, wakes, detach } = setup();
  bot.health = 20;
  bot.emit('health');
  assert.equal(wakes.length, 0);
  bot.health = 19.5;
  bot.emit('health');
  assert.match(wakes.at(-1), /took 0\.5 damage \(health 19\.5\/20\)/);
  detach();
});

test('only chat aimed at Claude interrupts an action, even with one player online', () => {
  const { bot, state, detach } = setup(['Edo']);
  const controller = new AbortController();
  state.action = { name: 'mine', controller };
  bot.emit('chat', 'Edo', 'lol this is taking forever');
  assert.equal(controller.signal.aborted, false);
  bot.emit('chat', 'Edo', 'claude stop');
  assert.equal(controller.signal.aborted, true);
  detach();
});
